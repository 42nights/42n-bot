#!/usr/bin/env tsx
/**
 * SWE-bench evaluation harness for Otis.
 *
 * Run from the 42n-bot repo root so data/bot.db and schema paths resolve:
 *   USE_ANTHROPIC_API_KEY=1 npm run swebench -- --limit 5 --concurrency 2
 *
 * Do NOT run the Otis coordinator concurrently — its reaper sweeps active-
 * status runs in the same data/bot.db.
 */

import fs from "node:fs";
import path from "node:path";
import { ensureSchema } from "../db/migrate";
import { botConfig } from "../../bot.config";
import { loadInstances } from "./dataset";
import { runInstance } from "./driver";
import { loadExistingPredictions, appendPrediction } from "./predictions";
import { DEFAULT_STRIP_PATTERNS, DEFAULTS } from "./config";
import type { HarnessOpts } from "./types";

// ── Minimal argument parser (no deps beyond Node built-ins) ──────────────

function parseArgs(argv: string[]): HarnessOpts & { help: boolean; noCache: boolean } {
  const args = argv.slice(2); // strip node + script
  const get = (flag: string): string | undefined => {
    const idx = args.indexOf(flag);
    if (idx === -1) return undefined;
    return args[idx + 1];
  };
  const has = (flag: string): boolean => args.includes(flag);

  if (has("--help") || has("-h")) {
    return {
      help: true,
      dataset: DEFAULTS.dataset,
      split: DEFAULTS.split,
      cacheDir: DEFAULTS.cacheDir,
      instances: null,
      limit: null,
      concurrency: DEFAULTS.concurrency,
      maxCostUsd: DEFAULTS.maxCostUsd,
      out: DEFAULTS.out,
      resume: false,
      modelName: DEFAULTS.modelName,
      stripPatterns: DEFAULT_STRIP_PATTERNS,
      noVenv: false,
      perRunCap: botConfig.budgets.perRunUsd,
      includeHints: false,
      noCache: false,
    };
  }

  const rawStrip = get("--strip");
  const stripPatterns: RegExp[] = rawStrip
    ? rawStrip.split(",").map((s) => new RegExp(s.trim()))
    : DEFAULT_STRIP_PATTERNS;

  const rawInstances = get("--instances");
  const instances = rawInstances ? rawInstances.split(",").map((s) => s.trim()) : null;

  const rawLimit = get("--limit");
  const limit = rawLimit ? parseInt(rawLimit, 10) : null;

  const rawConcurrency = get("--concurrency");
  const concurrency = rawConcurrency ? parseInt(rawConcurrency, 10) : DEFAULTS.concurrency;

  const rawMaxCost = get("--max-cost");
  const maxCostUsd = rawMaxCost ? parseFloat(rawMaxCost) : DEFAULTS.maxCostUsd;

  const rawPerRun = get("--per-run-cap");
  const perRunCap = rawPerRun ? parseFloat(rawPerRun) : botConfig.budgets.perRunUsd;

  return {
    help: false,
    dataset: get("--dataset") ?? DEFAULTS.dataset,
    split: get("--split") ?? DEFAULTS.split,
    cacheDir: get("--cache-dir") ?? DEFAULTS.cacheDir,
    instances,
    limit,
    concurrency,
    maxCostUsd,
    out: get("--out") ?? DEFAULTS.out,
    resume: has("--resume"),
    modelName: get("--model-name") ?? DEFAULTS.modelName,
    stripPatterns,
    noVenv: has("--no-venv"),
    perRunCap,
    includeHints: has("--hints"),
    noCache: has("--no-cache"),
  };
}

function printHelp(): void {
  process.stdout.write(`
SWE-bench evaluation harness for Otis.

Usage: npm run swebench -- [flags]

Flags:
  --dataset       HF dataset name (default: ${DEFAULTS.dataset})
  --split         Dataset split (default: ${DEFAULTS.split})
  --instances     Comma-list of instance_ids to run (overrides dataset/limit)
  --limit N       Max instances to run after filtering
  --concurrency N Parallel instances (default: ${DEFAULTS.concurrency}; each spawns claude subprocesses)
  --max-cost N    Global USD ceiling; skip new instances once cumulative cost >= N
  --per-run-cap N Per-instance USD cap (default: botConfig.budgets.perRunUsd)
  --out           Output predictions.jsonl path (default: ${DEFAULTS.out})
  --resume        Skip instances already in --out
  --model-name    model_name_or_path field in predictions (default: ${DEFAULTS.modelName})
  --strip         Comma-list of regex sources for test-file strip patterns
  --no-venv       Skip Python venv provisioning (use when PATH has deps — VM mode)
  --hints         Include hints_text in the prompt (NON-comparable; off by default)
  --no-cache      Re-fetch dataset even if cache exists
  --cache-dir     Directory for dataset cache (default: ${DEFAULTS.cacheDir})

Prerequisites:
  - Run from the 42n-bot repo root (data/bot.db resolves from cwd)
  - claude CLI on PATH (or CLAUDE_CODE_PATH env var)
  - USE_ANTHROPIC_API_KEY=1 or valid claude keychain login
  - Do NOT run the Otis coordinator concurrently (same data/bot.db)

Grading: ship predictions.jsonl to an x86 VM and run src/swebench/grade.sh.
Grading does not work on arm64/local (SWE-bench Docker images are x86-only).
`.trimStart());
}

// ── Concurrency pool (no dep, hand-rolled p-limit pattern) ───────────────

async function withConcurrency<T>(
  tasks: (() => Promise<T>)[],
  limit: number,
): Promise<T[]> {
  const results: T[] = [];
  let idx = 0;

  async function worker(): Promise<void> {
    while (idx < tasks.length) {
      const i = idx++;
      results[i] = await tasks[i]();
    }
  }

  const workers = Array.from({ length: Math.min(limit, tasks.length) }, () => worker());
  await Promise.all(workers);
  return results;
}

// ── Main ─────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const opts = parseArgs(process.argv);

  if (opts.help) {
    printHelp();
    process.exit(0);
  }

  // venv provisioning mutates the global process.env.PATH and uses blocking
  // execSync — both are unsafe across concurrent workers. Force serial when a
  // venv is in play. The VM full run uses --no-venv (env pre-built in Docker),
  // so it keeps full concurrency.
  if (!opts.noVenv && opts.concurrency > 1) {
    process.stderr.write(
      `Forcing --concurrency 1 (venv mode mutates global PATH; pass --no-venv for parallel runs)\n`,
    );
    opts.concurrency = 1;
  }

  // Ensure DB schema (creates phase_costs etc.) before any phase fns run.
  ensureSchema();

  // Ensure output dir exists.
  const outDir = path.dirname(path.resolve(opts.out));
  if (!fs.existsSync(outDir)) {
    fs.mkdirSync(outDir, { recursive: true });
  }

  process.stderr.write(`Loading dataset ${opts.dataset} / ${opts.split}\n`);
  let instances = await loadInstances({
    dataset: opts.dataset,
    split: opts.split,
    cacheDir: opts.cacheDir,
    noCache: opts.noCache,
  });
  process.stderr.write(`Dataset: ${instances.length} total instances\n`);

  // Filter by explicit instance list.
  if (opts.instances && opts.instances.length > 0) {
    const idSet = new Set(opts.instances);
    instances = instances.filter((i) => idSet.has(i.instance_id));
    process.stderr.write(`Filtered to ${instances.length} instances by --instances\n`);
  }

  // Apply --limit.
  if (opts.limit !== null && instances.length > opts.limit) {
    instances = instances.slice(0, opts.limit);
  }

  // Load existing predictions for --resume.
  const done = opts.resume ? loadExistingPredictions(opts.out) : new Set<string>();
  if (done.size > 0) {
    process.stderr.write(`Resuming: ${done.size} instances already in ${opts.out}\n`);
  }

  let cumulativeCost = 0;
  let attempted = 0;
  let nonEmpty = 0;

  const tasks = instances.map((inst) => async (): Promise<void> => {
    if (done.has(inst.instance_id)) {
      process.stderr.write(`Skip (already done): ${inst.instance_id}\n`);
      return;
    }

    if (cumulativeCost >= opts.maxCostUsd) {
      process.stderr.write(
        `Skip (budget $${opts.maxCostUsd} reached): ${inst.instance_id}\n`,
      );
      // Write an empty prediction so --resume knows we touched this instance.
      appendPrediction(opts.out, {
        instance_id: inst.instance_id,
        model_name_or_path: opts.modelName,
        model_patch: "",
      });
      return;
    }

    process.stderr.write(`Starting: ${inst.instance_id}\n`);
    attempted++;

    const result = await runInstance(inst, {
      perRunCap: opts.perRunCap,
      noVenv: opts.noVenv,
      stripPatterns: opts.stripPatterns,
      includeHints: opts.includeHints,
    });

    cumulativeCost += result.costUsd;
    if (result.model_patch) nonEmpty++;

    appendPrediction(opts.out, {
      instance_id: result.instance_id,
      model_name_or_path: opts.modelName,
      model_patch: result.model_patch,
    });

    process.stderr.write(
      `Done: ${inst.instance_id} outcome=${result.outcome} ` +
        `cost=$${result.costUsd.toFixed(3)} total=$${cumulativeCost.toFixed(3)}\n`,
    );
  });

  await withConcurrency(tasks, opts.concurrency);

  process.stdout.write(
    `\nSummary:\n` +
      `  Instances attempted : ${attempted}\n` +
      `  Non-empty patches   : ${nonEmpty}\n` +
      `  Total cost          : $${cumulativeCost.toFixed(4)}\n` +
      `  Predictions file    : ${opts.out}\n`,
  );
}

main().catch((err) => {
  process.stderr.write(`Fatal: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
