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
  const missing: string[] = [];
  for (const rf of understanding.relevant_files) {
    // `path` relative to the worktree. Reject anything that tries to escape.
    const abs = path.resolve(cwd, rf.path);
    if (!abs.startsWith(path.resolve(cwd))) {
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

  // Less than half missing — just record the unknowns, leave confidence alone.
  if (missRatio < 0.5) {
    return {
      ...understanding,
      unknowns: [
        ...understanding.unknowns,
        ...missing.map((p) => `Claimed file does not exist: ${p}`),
      ],
    };
  }

  // Majority missing — fabricated. Drop confidence so the implementer aborts.
  return {
    ...understanding,
    confidence_to_proceed: 0,
    proceed: false,
    abort_reason:
      `${missing.length} of ${understanding.relevant_files.length} files I claimed to read don't exist in the worktree. ` +
      `This understanding is probably fabricated — refusing to proceed.`,
    unknowns: [
      ...understanding.unknowns,
      ...missing.map((p) => `Claimed file does not exist: ${p}`),
    ],
  };
}

export async function runUnderstand(opts: {
  runId: number;
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
