import { botConfig } from "../../../bot.config";
import { understandPrompt, UNDERSTAND_JSON_SCHEMA, type IssueForPrompt } from "../prompts";
import { runStructuredPlan } from "../runner";
import { emitEvent } from "../../shared/events";
import { recordPhaseCost } from "./cost-tracker";
import { UnderstandingSchema, type Understanding } from "./types";

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

    recordPhaseCost({
      runId: opts.runId,
      phase: "understand",
      costUsd: result.costUsd,
      durationMs,
      ok: true,
    });
    emitEvent(opts.runId, "understand.completed", { understanding: result.plan });
    return { ok: true, understanding: result.plan, costUsd: result.costUsd };
  } catch (err) {
    const durationMs = Date.now() - startedAt;
    const error = err instanceof Error ? err.message : String(err);
    recordPhaseCost({ runId: opts.runId, phase: "understand", costUsd: 0, durationMs, ok: false });
    emitEvent(opts.runId, "understand.failed", { error });
    return { ok: false, error, partialCostUsd: 0 };
  }
}
