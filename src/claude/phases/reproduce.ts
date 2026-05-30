import { botConfig } from "../../../bot.config";
import { reproducePrompt, REPRO_JSON_SCHEMA, type IssueForPrompt } from "../prompts";
import { runStructuredPlan } from "../runner";
import { emitEvent } from "../../shared/events";
import { recordPhaseCost } from "./cost-tracker";
import { ReproduceSchema, type Reproduce, type Understanding } from "./types";

export async function runReproduce(opts: {
  runId: number;
  issue: IssueForPrompt;
  understanding: Understanding;
  cwd: string;
  costBudgetUsd?: number;
}): Promise<
  | { ok: true; reproduce: Reproduce; costUsd: number }
  | { ok: false; error: string; partialCostUsd: number }
> {
  const startedAt = Date.now();
  emitEvent(opts.runId, "reproduce.started", { issueNumber: opts.issue.number });

  try {
    const result = await runStructuredPlan({
      runId: opts.runId,
      prompt: reproducePrompt(opts.issue, opts.understanding),
      schema: ReproduceSchema,
      jsonSchema: REPRO_JSON_SCHEMA,
      cwd: opts.cwd,
      costBudgetUsd: opts.costBudgetUsd ?? botConfig.budgets.perRunUsd,
      allowedTools: botConfig.allowedTools,
      permissionMode: "acceptEdits",
    });

    const durationMs = Date.now() - startedAt;

    if (!result.ok) {
      recordPhaseCost({
        runId: opts.runId,
        phase: "reproduce",
        costUsd: result.partialCostUsd ?? 0,
        durationMs,
        ok: false,
      });
      emitEvent(opts.runId, "reproduce.failed", { error: result.error });
      return { ok: false, error: result.error, partialCostUsd: result.partialCostUsd ?? 0 };
    }

    recordPhaseCost({
      runId: opts.runId,
      phase: "reproduce",
      costUsd: result.costUsd,
      durationMs,
      ok: true,
    });
    emitEvent(opts.runId, "reproduce.completed", { reproduce: result.plan });
    return { ok: true, reproduce: result.plan, costUsd: result.costUsd };
  } catch (err) {
    const durationMs = Date.now() - startedAt;
    const error = err instanceof Error ? err.message : String(err);
    recordPhaseCost({ runId: opts.runId, phase: "reproduce", costUsd: 0, durationMs, ok: false });
    emitEvent(opts.runId, "reproduce.failed", { error });
    return { ok: false, error, partialCostUsd: 0 };
  }
}
