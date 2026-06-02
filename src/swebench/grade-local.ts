#!/usr/bin/env node
/**
 * LOCAL grader — a no-Docker approximation of the official SWE-bench resolved
 * check, for repos that install cleanly on this host.
 *
 * For each prediction it: checks out repo@base_commit, provisions a venv,
 * applies the model_patch, then applies the gold test_patch, then runs the
 * exact FAIL_TO_PASS + PASS_TO_PASS pytest node IDs. An instance is "resolved"
 * iff every FAIL_TO_PASS id and every PASS_TO_PASS id passes — the same
 * criterion the official harness uses.
 *
 * THIS IS NOT THE OFFICIAL HARNESS. It can only UNDER-count vs. official:
 *   - local dep versions drift from the image-pinned ones (P2P false-fails),
 *   - tests needing external services (httpbin, a DB) fail with no server.
 * So a local "resolved" is trustworthy; a local "unresolved" may be an
 * environment artifact. Report local numbers as a conservative lower bound and
 * run src/swebench/grade.sh on an x86 Docker host for the comparable figure.
 *
 *   node dist/src/swebench/grade-local.js --predictions data/swebench/pilot_predictions.jsonl \
 *     --out data/swebench/pilot_grades.json
 */

import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";
import { loadInstances } from "./dataset";
import { ensureRepoClone, checkoutInstance, cleanupCheckout } from "./clone-cache";
import { provisionPythonEnv } from "./pyenv";
import { DEFAULTS } from "./config";
import type { SwebenchInstance } from "./types";

const PYTEST_TIMEOUT_MS = 900_000;
// Grade worktrees live in a separate runId namespace so they never collide
// with the driver's per-run worktree dirs.
const GRADE_ID_BASE = 1_000_000;

type GradeResult = {
  instance_id: string;
  repo: string;
  resolved: boolean;
  f2p_total: number;
  f2p_passed: number;
  p2p_total: number;
  p2p_passed: number;
  empty_patch: boolean;
  error: string | null;
};

function parseArgs(argv: string[]) {
  const args = argv.slice(2);
  const get = (f: string) => {
    const i = args.indexOf(f);
    return i === -1 ? undefined : args[i + 1];
  };
  return {
    predictions: get("--predictions") ?? "data/swebench/predictions.jsonl",
    out: get("--out") ?? "data/swebench/grades.json",
    dataset: get("--dataset") ?? DEFAULTS.dataset,
    split: get("--split") ?? DEFAULTS.split,
    cacheDir: get("--cache-dir") ?? DEFAULTS.cacheDir,
    noVenv: args.includes("--no-venv"),
  };
}

/** Read predictions.jsonl → Map<instance_id, model_patch>. */
function loadPredictions(file: string): Map<string, string> {
  const map = new Map<string, string>();
  if (!fs.existsSync(file)) throw new Error(`predictions file not found: ${file}`);
  for (const line of fs.readFileSync(file, "utf8").split("\n")) {
    if (!line.trim()) continue;
    try {
      const p = JSON.parse(line) as { instance_id?: string; model_patch?: string };
      if (typeof p.instance_id === "string") {
        map.set(p.instance_id, p.model_patch ?? "");
      }
    } catch {
      /* tolerate partial trailing line */
    }
  }
  return map;
}

/** Apply a patch string in cwd. Tries `git apply` then `patch -p1`. */
function applyPatch(cwd: string, patch: string, label: string): void {
  const file = path.join(cwd, `_${label}.patch`);
  fs.writeFileSync(file, patch.endsWith("\n") ? patch : patch + "\n");
  try {
    execSync(`git apply --whitespace=nowarn "${file}"`, {
      cwd,
      stdio: ["ignore", "ignore", "pipe"],
    });
    return;
  } catch {
    // Fall back to a more lenient apply.
    try {
      execSync(`git apply --3way --whitespace=nowarn "${file}"`, {
        cwd,
        stdio: ["ignore", "ignore", "pipe"],
      });
      return;
    } catch {
      execSync(`patch -p1 --fuzz=3 < "${file}"`, {
        cwd,
        stdio: ["ignore", "ignore", "pipe"],
        shell: "/bin/bash",
      });
    }
  }
}

/**
 * Run the given pytest node IDs and return per-id outcomes parsed from the
 * `-rA` short-summary lines ("PASSED <nodeid>", "FAILED <nodeid>", ...).
 */
function runPytest(
  cwd: string,
  ids: string[],
): Map<string, "PASSED" | "FAILED" | "ERROR" | "SKIPPED" | "MISSING"> {
  const outcomes = new Map<
    string,
    "PASSED" | "FAILED" | "ERROR" | "SKIPPED" | "MISSING"
  >();
  for (const id of ids) outcomes.set(id, "MISSING");
  if (ids.length === 0) return outcomes;

  // Write the node IDs to a file and pass via @file so a huge P2P set can't
  // blow ARG_MAX.
  const idFile = path.join(cwd, "_pytest_ids.txt");
  fs.writeFileSync(idFile, ids.join("\n"));

  let stdout = "";
  try {
    // `set -f` disables pathname expansion so parametrized node IDs like
    // `test_x.py::test_y[case]` aren't glob-mangled by bash.
    stdout = execSync(
      `set -f; python -m pytest -rA --tb=no -q -p no:cacheprovider $(cat "${idFile}" | tr '\\n' ' ')`,
      {
        cwd,
        stdio: ["ignore", "pipe", "pipe"],
        shell: "/bin/bash",
        timeout: PYTEST_TIMEOUT_MS,
        maxBuffer: 64 * 1024 * 1024,
        encoding: "utf8",
      },
    );
  } catch (err) {
    // pytest exits non-zero whenever any test fails — that's expected. Parse
    // whatever it printed to stdout.
    const e = err as { stdout?: string | Buffer };
    stdout = typeof e.stdout === "string" ? e.stdout : (e.stdout?.toString() ?? "");
  }

  for (const line of stdout.split("\n")) {
    const m = /^(PASSED|FAILED|ERROR|SKIPPED)\s+(\S+)/.exec(line.trim());
    if (!m) continue;
    const [, outcome, nodeid] = m;
    // Match the reported nodeid against requested ids (exact, or suffix to
    // tolerate a leading path normalization difference).
    for (const id of ids) {
      if (nodeid === id || nodeid.endsWith(id) || id.endsWith(nodeid)) {
        outcomes.set(id, outcome as "PASSED" | "FAILED" | "ERROR" | "SKIPPED");
      }
    }
  }
  return outcomes;
}

async function gradeOne(
  inst: SwebenchInstance,
  modelPatch: string,
  gradeId: string,
  noVenv: boolean,
): Promise<GradeResult> {
  const f2p: string[] = JSON.parse(inst.FAIL_TO_PASS);
  const p2p: string[] = JSON.parse(inst.PASS_TO_PASS);
  const base: GradeResult = {
    instance_id: inst.instance_id,
    repo: inst.repo,
    resolved: false,
    f2p_total: f2p.length,
    f2p_passed: 0,
    p2p_total: p2p.length,
    p2p_passed: 0,
    empty_patch: !modelPatch.trim(),
    error: null,
  };
  if (!modelPatch.trim()) return base;

  let worktree: string | null = null;
  const origPath = process.env.PATH;
  try {
    await ensureRepoClone(inst.repo);
    worktree = await checkoutInstance(inst.repo, inst.base_commit, gradeId);

    const prefix = await provisionPythonEnv(worktree, noVenv);
    if (prefix) process.env.PATH = `${prefix}:${origPath ?? ""}`;

    try {
      applyPatch(worktree, modelPatch, "model");
    } catch (err) {
      base.error = `model patch apply failed: ${err instanceof Error ? err.message.slice(0, 160) : err}`;
      return base;
    }
    try {
      if (inst.test_patch) applyPatch(worktree, inst.test_patch, "test");
    } catch (err) {
      base.error = `gold test patch apply failed: ${err instanceof Error ? err.message.slice(0, 160) : err}`;
      return base;
    }

    const all = [...f2p, ...p2p];
    const outcomes = runPytest(worktree, all);
    base.f2p_passed = f2p.filter((id) => outcomes.get(id) === "PASSED").length;
    base.p2p_passed = p2p.filter((id) => outcomes.get(id) === "PASSED").length;
    base.resolved =
      base.f2p_passed === base.f2p_total && base.p2p_passed === base.p2p_total;
    return base;
  } catch (err) {
    base.error = err instanceof Error ? err.message.slice(0, 200) : String(err);
    return base;
  } finally {
    if (prefixRestoreNeeded(origPath, process.env.PATH)) {
      process.env.PATH = origPath;
    }
    if (worktree) await cleanupCheckout(inst.repo, gradeId).catch(() => {});
  }
}

function prefixRestoreNeeded(orig: string | undefined, current: string | undefined): boolean {
  return orig !== undefined && orig !== current;
}

async function main(): Promise<void> {
  const opts = parseArgs(process.argv);
  const preds = loadPredictions(opts.predictions);
  const instances = await loadInstances({
    dataset: opts.dataset,
    split: opts.split,
    cacheDir: opts.cacheDir,
  });
  const byId = new Map(instances.map((i) => [i.instance_id, i]));

  const results: GradeResult[] = [];
  let idx = 0;
  for (const [instanceId, patch] of preds) {
    const inst = byId.get(instanceId);
    if (!inst) {
      process.stderr.write(`Skip (not in dataset): ${instanceId}\n`);
      continue;
    }
    process.stderr.write(`Grading ${instanceId}...\n`);
    const r = await gradeOne(inst, patch, `grade-${GRADE_ID_BASE + idx++}`, opts.noVenv);
    results.push(r);
    process.stderr.write(
      `  ${r.resolved ? "RESOLVED" : "unresolved"} ` +
        `F2P ${r.f2p_passed}/${r.f2p_total} P2P ${r.p2p_passed}/${r.p2p_total}` +
        `${r.empty_patch ? " (empty patch)" : ""}${r.error ? ` [${r.error}]` : ""}\n`,
    );
  }

  const resolved = results.filter((r) => r.resolved).length;
  const withPatch = results.filter((r) => !r.empty_patch).length;
  const report = {
    grader: "local-approximation-no-docker",
    caveat:
      "Conservative lower bound. Local dep drift + missing external services " +
      "(httpbin etc.) can cause false-unresolved. Official numbers require the " +
      "x86 Docker harness (src/swebench/grade.sh).",
    total: results.length,
    with_patch: withPatch,
    resolved,
    resolved_rate_of_all: results.length ? resolved / results.length : 0,
    resolved_rate_of_attempted: withPatch ? resolved / withPatch : 0,
    results,
  };

  fs.writeFileSync(opts.out, JSON.stringify(report, null, 2));
  process.stdout.write(
    `\nLocal grade summary (NOT official):\n` +
      `  Total graded     : ${results.length}\n` +
      `  Non-empty patches: ${withPatch}\n` +
      `  Resolved         : ${resolved}\n` +
      `  Resolved / all   : ${(report.resolved_rate_of_all * 100).toFixed(1)}%\n` +
      `  Report           : ${opts.out}\n`,
  );
}

main().catch((err) => {
  process.stderr.write(`Fatal: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
