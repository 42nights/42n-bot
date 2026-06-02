import { botConfig } from "../../../bot.config";
import { designPrompt, DESIGN_JSON_SCHEMA, type IssueForPrompt } from "../prompts";
import { runStructuredPlan } from "../runner";
import { emitEvent } from "../../shared/events";
import { recordPhaseCost } from "./cost-tracker";
import { DesignSchema, type Design, type Understanding } from "./types";

export async function runDesign(opts: {
  runId: string;
  issue: IssueForPrompt;
  understanding: Understanding;
  cwd: string;
  costBudgetUsd?: number;
}): Promise<
  | { ok: true; design: Design; costUsd: number }
  | { ok: false; error: string; partialCostUsd: number }
> {
  const startedAt = Date.now();
  emitEvent(opts.runId, "design.started", { issueNumber: opts.issue.number });

  try {
    const result = await runStructuredPlan({
      runId: opts.runId,
      prompt: designPrompt(opts.issue, opts.understanding),
      schema: DesignSchema,
      jsonSchema: DESIGN_JSON_SCHEMA,
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
        phase: "design",
        costUsd: result.partialCostUsd ?? 0,
        durationMs,
        ok: false,
      });
      emitEvent(opts.runId, "design.failed", { error: result.error });
      return { ok: false, error: result.error, partialCostUsd: result.partialCostUsd ?? 0 };
    }

    recordPhaseCost({
      runId: opts.runId,
      phase: "design",
      costUsd: result.costUsd,
      durationMs,
      ok: true,
    });
    emitEvent(opts.runId, "design.completed", { design: result.plan });
    return { ok: true, design: result.plan, costUsd: result.costUsd };
  } catch (err) {
    const durationMs = Date.now() - startedAt;
    const error = err instanceof Error ? err.message : String(err);
    recordPhaseCost({ runId: opts.runId, phase: "design", costUsd: 0, durationMs, ok: false });
    emitEvent(opts.runId, "design.failed", { error });
    return { ok: false, error, partialCostUsd: 0 };
  }
}
