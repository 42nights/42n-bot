import { z } from "zod";
import { botConfig } from "../../../bot.config";
import { planPromptV2, PLAN_JSON_SCHEMA, type IssueForPrompt } from "../prompts";
import { runStructuredPlan } from "../runner";
import { emitEvent } from "../../shared/events";
import { recordPhaseCost } from "./cost-tracker";
import type { Understanding } from "./types";

// Plan schema extended with acceptance_test_paths (mirrors planPromptV2 JSON schema output).
const ReplanOutputSchema = z.object({
  files_to_change: z.array(
    z.object({
      path: z.string(),
      kind: z.enum(["modify", "create", "delete"]),
      why: z.string(),
    }),
  ),
  tests_to_add_or_update: z.array(
    z.object({
      path: z.string(),
      describes: z.string(),
    }),
  ),
  user_visible_change: z.string(),
  edge_cases: z.array(z.string()),
  complexity: z.enum(["trivial", "small", "medium", "large"]),
  should_abort: z.boolean(),
  abort_reason: z.string().nullable(),
  acceptance_test_paths: z.array(z.string()).optional(),
});

const REPLAN_JSON_SCHEMA = {
  ...PLAN_JSON_SCHEMA,
  properties: {
    ...PLAN_JSON_SCHEMA.properties,
    acceptance_test_paths: {
      type: "array" as const,
      items: { type: "string" as const },
    },
  },
  required: [...PLAN_JSON_SCHEMA.required, "acceptance_test_paths"],
};

export async function runReplan(opts: {
  runId: number;
  issue: IssueForPrompt;
  understanding: Understanding;
  originalPlan: unknown;
  discovered: string;
  suggestedNewFiles: string[];
  attempt: number;
  cwd: string;
  costBudgetUsd?: number;
}): Promise<
  | { ok: true; plan: unknown; costUsd: number }
  | { ok: false; error: string; partialCostUsd: number }
> {
  const startedAt = Date.now();
  emitEvent(opts.runId, "replan.started", {
    issueNumber: opts.issue.number,
    attempt: opts.attempt,
  });

  const basePrompt = planPromptV2({
    issue: opts.issue,
    understanding: opts.understanding,
    reproTestPath: null,
    designJson: null,
  });

  const revisionBlock = `
---
PREVIOUS PLAN WAS WRONG — PLAN REVISION REQUEST (attempt ${opts.attempt})

The implementer stopped mid-execution and reported:

  discovered: "${opts.discovered}"

  suggested_new_files: ${JSON.stringify(opts.suggestedNewFiles, null, 2)}

Original plan that was abandoned:
${JSON.stringify(opts.originalPlan, null, 2)}

Produce a CORRECTED plan that accounts for what the implementer discovered.
Explain in each affected file's "why" field why the original plan was wrong.
`;

  const prompt = basePrompt + revisionBlock;

  try {
    const result = await runStructuredPlan({
      runId: opts.runId,
      prompt,
      schema: ReplanOutputSchema,
      jsonSchema: REPLAN_JSON_SCHEMA,
      cwd: opts.cwd,
      costBudgetUsd: opts.costBudgetUsd ?? botConfig.budgets.perRunUsd,
      timeoutMs: botConfig.claudeCode.plannerTimeoutMs,
      allowedTools: ["Read", "Grep", "Glob"],
      permissionMode: "dontAsk",
    });

    const durationMs = Date.now() - startedAt;

    if (!result.ok) {
      recordPhaseCost({
        runId: opts.runId,
        phase: "replan",
        attempt: opts.attempt,
        costUsd: result.partialCostUsd ?? 0,
        durationMs,
        ok: false,
      });
      emitEvent(opts.runId, "replan.failed", { attempt: opts.attempt, error: result.error });
      return { ok: false, error: result.error, partialCostUsd: result.partialCostUsd ?? 0 };
    }

    recordPhaseCost({
      runId: opts.runId,
      phase: "replan",
      attempt: opts.attempt,
      costUsd: result.costUsd,
      durationMs,
      ok: true,
    });
    emitEvent(opts.runId, "replan.completed", { attempt: opts.attempt, plan: result.plan });
    return { ok: true, plan: result.plan, costUsd: result.costUsd };
  } catch (err) {
    const durationMs = Date.now() - startedAt;
    const error = err instanceof Error ? err.message : String(err);
    recordPhaseCost({
      runId: opts.runId,
      phase: "replan",
      attempt: opts.attempt,
      costUsd: 0,
      durationMs,
      ok: false,
    });
    emitEvent(opts.runId, "replan.failed", { attempt: opts.attempt, error });
    return { ok: false, error, partialCostUsd: 0 };
  }
}
