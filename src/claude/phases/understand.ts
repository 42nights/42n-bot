import fs from "node:fs";
import path from "node:path";
import { botConfig } from "../../../bot.config";
import { understandPrompt, UNDERSTAND_JSON_SCHEMA, type IssueForPrompt } from "../prompts";
import { runStructuredPlan } from "../runner";
import { emitEvent } from "../../shared/events";
import { log } from "../../shared/logger";
import { recordPhaseCost } from "./cost-tracker";
import { UnderstandingSchema, type Understanding } from "./types";

/**
 * QA1: the schema requires `relevant_files.length >= 1`, but it doesn't
 * verify those paths actually EXIST in the worktree. A model can pass schema
 * validation by hallucinating plausible-looking paths and we have no
 * structural defense.
 *
 * Strategy: stat every claimed file. If more than 50% are missing the
 * understanding is fabricated — drop confidence to 0, push the missing paths
 * into `unknowns`, and let the implementer abort on the confidence threshold.
 */
function postValidate(
  understanding: Understanding,
  cwd: string,
): Understanding {
  if (understanding.relevant_files.length === 0) return understanding;
  const base = path.resolve(cwd);
  const missing: string[] = [];
  for (const rf of understanding.relevant_files) {
    // `path` relative to the worktree. Reject anything that escapes. QA4:
    // separator-aware so a sibling dir `<base>-evil/...` isn't accepted.
    const abs = path.resolve(cwd, rf.path);
    if (abs !== base && !abs.startsWith(base + path.sep)) {
      missing.push(rf.path);
      continue;
    }
    try {
      fs.statSync(abs);
    } catch {
      missing.push(rf.path);
    }
  }
  const missRatio = missing.length / understanding.relevant_files.length;
  if (missRatio === 0) return understanding;

  log.warn(
    "understand",
    `${missing.length}/${understanding.relevant_files.length} relevant_files don't exist: ${missing.slice(0, 5).join(", ")}`,
  );

  // QA2: a model can game a 50% threshold by padding hallucinations with
  // files that exist in every repo (package.json, README, tsconfig). We
  // discount "ubiquitous" files when computing the trust ratio — a claim
  // that consists only of these + hallucinations is still fabricated.
  const UBIQUITOUS = new Set([
    "package.json",
    "package-lock.json",
    "readme.md",
    "tsconfig.json",
    "tsconfig.base.json",
    ".gitignore",
    "license",
    "yarn.lock",
    "pnpm-lock.yaml",
  ]);
  const existing = understanding.relevant_files.filter(
    (rf) => !missing.includes(rf.path),
  );
  const substantiveExisting = existing.filter(
    (rf) => !UBIQUITOUS.has(rf.path.split("/").pop()?.toLowerCase() ?? ""),
  );

  // Abort when EITHER:
  //  - 30%+ of claimed files don't exist (lowered from 50%), OR
  //  - the model claimed more than 2 files but zero substantive (non-
  //    ubiquitous) ones actually exist — i.e. it padded with common files.
  const fabricated =
    missRatio >= 0.3 ||
    (understanding.relevant_files.length > 2 &&
      substantiveExisting.length === 0);

  if (!fabricated) {
    return {
      ...understanding,
      unknowns: [
        ...understanding.unknowns,
        ...missing.map((p) => `Claimed file does not exist: ${p}`),
      ],
    };
  }

  return {
    ...understanding,
    confidence_to_proceed: 0,
    proceed: false,
    abort_reason:
      `${missing.length} of ${understanding.relevant_files.length} files I claimed to read don't exist in the worktree` +
      (substantiveExisting.length === 0
        ? `, and the ones that do exist are ubiquitous boilerplate (package.json etc.)` +
          ` — this understanding looks padded rather than grounded.`
        : `. This understanding is probably fabricated — refusing to proceed.`),
    unknowns: [
      ...understanding.unknowns,
      ...missing.map((p) => `Claimed file does not exist: ${p}`),
    ],
  };
}

export async function runUnderstand(opts: {
  runId: string;
  issue: IssueForPrompt;
  cwd: string;
  costBudgetUsd?: number;
}): Promise<
  | { ok: true; understanding: Understanding; costUsd: number }
  | { ok: false; error: string; partialCostUsd: number }
> {
  const startedAt = Date.now();
  emitEvent(opts.runId, "understand.started", { issueNumber: opts.issue.number });

  try {
    const result = await runStructuredPlan({
      runId: opts.runId,
      prompt: understandPrompt(opts.issue),
      schema: UnderstandingSchema,
      jsonSchema: UNDERSTAND_JSON_SCHEMA,
      cwd: opts.cwd,
      timeoutMs: botConfig.claudeCode.plannerTimeoutMs,
      costBudgetUsd: opts.costBudgetUsd ?? botConfig.budgets.perRunUsd,
      allowedTools: ["Read", "Grep", "Glob"],
      permissionMode: "dontAsk",
    });

    const durationMs = Date.now() - startedAt;

    if (!result.ok) {
      recordPhaseCost({
        runId: opts.runId,
        phase: "understand",
        costUsd: result.partialCostUsd ?? 0,
        durationMs,
        ok: false,
      });
      emitEvent(opts.runId, "understand.failed", { error: result.error });
      return { ok: false, error: result.error, partialCostUsd: result.partialCostUsd ?? 0 };
    }

    const validated = postValidate(result.plan, opts.cwd);
    recordPhaseCost({
      runId: opts.runId,
      phase: "understand",
      costUsd: result.costUsd,
      durationMs,
      ok: true,
    });
    emitEvent(opts.runId, "understand.completed", { understanding: validated });
    return { ok: true, understanding: validated, costUsd: result.costUsd };
  } catch (err) {
    const durationMs = Date.now() - startedAt;
    const error = err instanceof Error ? err.message : String(err);
    recordPhaseCost({ runId: opts.runId, phase: "understand", costUsd: 0, durationMs, ok: false });
    emitEvent(opts.runId, "understand.failed", { error });
    return { ok: false, error, partialCostUsd: 0 };
  }
}
