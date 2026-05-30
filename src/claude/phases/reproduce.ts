import fs from "node:fs";
import path from "node:path";
import { botConfig } from "../../../bot.config";
import { reproducePrompt, REPRO_JSON_SCHEMA, type IssueForPrompt } from "../prompts";
import { runStructuredPlan } from "../runner";
import { emitEvent } from "../../shared/events";
import { log } from "../../shared/logger";
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

    // QA3 (R3 finding 2): the model claims reproduced=true + a test path, but
    // nothing checks the file actually exists. The bot can run `rm -f` and
    // delete the test, or hallucinate the path — then this path flows into
    // acceptance_test_paths and verification fails with a cryptic "test file
    // not found" that looks like a real failure. Validate it exists; if not,
    // downgrade to reproduced=false with a clear reason (same pattern as
    // understand.ts post-validation).
    let repro = result.plan;
    if (repro.reproduced) {
      const rel = repro.test_file_path?.trim() ?? "";
      const abs = rel ? path.resolve(opts.cwd, rel) : "";
      const base = path.resolve(opts.cwd);
      // QA4: separator-aware boundary check. `startsWith(base)` alone would
      // accept a SIBLING dir like `<base>-evil/...` (prefix match, not a
      // directory boundary). Require an exact match or a `<base>/` prefix.
      const inside = !!abs && (abs === base || abs.startsWith(base + path.sep));
      const exists = inside && fs.existsSync(abs);
      if (!exists) {
        log.warn(
          "reproduce",
          `claimed reproduced=true but test file "${rel}" does not exist in the worktree — downgrading`,
        );
        repro = {
          ...repro,
          reproduced: false,
          cannot_reproduce_reason:
            repro.cannot_reproduce_reason ??
            `The reproduction test "${rel}" was reported as written but does not exist in the worktree. ` +
              `Cannot proceed without a real failing test.`,
        };
      }
    }

    emitEvent(opts.runId, "reproduce.completed", { reproduce: repro });
    return { ok: true, reproduce: repro, costUsd: result.costUsd };
  } catch (err) {
    const durationMs = Date.now() - startedAt;
    const error = err instanceof Error ? err.message : String(err);
    recordPhaseCost({ runId: opts.runId, phase: "reproduce", costUsd: 0, durationMs, ok: false });
    emitEvent(opts.runId, "reproduce.failed", { error });
    return { ok: false, error, partialCostUsd: 0 };
  }
}
