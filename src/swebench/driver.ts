/**
 * Per-instance control flow. Mirrors runImplementer's UNDERSTAND → REPRODUCE |
 * DESIGN → PLAN → IMPLEMENT↔VERIFY loop, but with all GitHub edges removed.
 *
 * Does NOT import runImplementer — we copy its loop body and swap the GitHub
 * edges for no-ops / logging. We DO import every phase fn and shared util.
 */

import { z } from "zod";
import { botConfig } from "../../bot.config";
import { runClaudeCode } from "../claude/runner";
import { runStructuredPlan } from "../claude/runner";
import {
  PLAN_V2_JSON_SCHEMA,
  implementPromptV2,
  iterationPrompt,
  planPromptV2,
  type IssueForPrompt,
  type UnderstandingForPrompt,
} from "../claude/prompts";
import { runUnderstand } from "../claude/phases/understand";
import { runReproduce } from "../claude/phases/reproduce";
import { runDesign } from "../claude/phases/design";
import { runReplan } from "../claude/phases/replan";
import { parseImplementerRequests } from "../claude/parse-requests";
import { recordPhaseCost } from "../claude/phases/cost-tracker";
import type { Understanding } from "../claude/phases/types";
import { runVerification } from "../verification";
import type { Plan, Verdict } from "../verification/types";
import { log } from "../shared/logger";
import { emitEvent } from "../shared/events";
import {
  createSwebenchRun,
  updateRunStatus,
  incRunCost,
  saveRunArtifact,
  finishRun,
} from "./run-row";
import {
  ensureRepoClone,
  checkoutInstance,
  cleanupCheckout,
} from "./clone-cache";
import { provisionPythonEnv } from "./pyenv";
import { captureModelPatch } from "./diff-strip";
import { instanceToIssue } from "./issue";
import type { SwebenchInstance, InstanceResult, HarnessOpts } from "./types";

// ── Types mirrored from implementer.ts (module-private there) ────────────

const PlanSchema = z.object({
  files_to_change: z.array(
    z.object({
      path: z.string(),
      kind: z.enum(["modify", "create", "delete"]),
      why: z.string(),
    }),
  ),
  tests_to_add_or_update: z.array(
    z.object({ path: z.string(), describes: z.string() }),
  ),
  user_visible_change: z.string(),
  edge_cases: z.array(z.string()),
  complexity: z.enum(["trivial", "small", "medium", "large"]),
  should_abort: z.boolean(),
  abort_reason: z.string().nullable(),
  acceptance_test_paths: z.array(z.string()).optional(),
}) satisfies z.ZodType<Plan>;

function asUnderstandingForPrompt(u: Understanding): UnderstandingForPrompt {
  return {
    issue_type: u.issue_type,
    issue_summary: u.issue_summary,
    acceptance_criteria: u.acceptance_criteria,
    user_visible_outcome: u.user_visible_outcome,
    relevant_files: u.relevant_files,
  };
}

/** Failing checks formatted for the iteration prompt — copied from implementer.ts. */
function verdictForRetry(v: Verdict): string {
  const failing = Object.values(v.checks).filter((c) => !c.pass);
  return failing
    .map((c) => {
      const detail = c.detail as { stdoutTail?: string } | undefined;
      const tail = detail?.stdoutTail?.slice(-200) ?? "";
      const indented = tail.replace(/\n/g, "\n    ");
      return `- ${c.name} (${c.hardGate ? "HARD" : "soft"}): ${c.message}${tail ? `\n    ${indented}` : ""}`;
    })
    .join("\n");
}

function computeAcceptancePaths(plan: Plan, reproTestPath: string | null): string[] {
  const set = new Set<string>([
    ...(reproTestPath ? [reproTestPath] : []),
    ...((plan.acceptance_test_paths ?? []) as string[]),
  ]);
  return Array.from(set);
}

// ── Main per-instance driver ──────────────────────────────────────────────

export async function runInstance(
  inst: SwebenchInstance,
  opts: Pick<HarnessOpts, "perRunCap" | "noVenv" | "stripPatterns" | "includeHints">,
): Promise<InstanceResult> {
  const issue: IssueForPrompt = instanceToIssue(inst, opts.includeHints);
  let runId: string;
  let worktreePath: string | null = null;
  let totalCost = 0;

  // Step 2: create run row (FK anchor for all subsequent emitEvent calls).
  runId = await createSwebenchRun(inst);

  try {
    // Step 3: checkout at base_commit.
    await ensureRepoClone(inst.repo);
    worktreePath = await checkoutInstance(inst.repo, inst.base_commit, runId);
    void updateRunStatus(runId, "planning", {
      branch_name: `swebench/${inst.instance_id}`,
      worktree_path: worktreePath,
    });

    // Step 4: provision Python env (no-op in VM mode).
    const pathPrefix = await provisionPythonEnv(worktreePath, opts.noVenv);
    const origPath = process.env.PATH;
    if (pathPrefix) {
      process.env.PATH = `${pathPrefix}:${origPath ?? ""}`;
    }

    try {
      return await runInstanceInner(inst, issue, runId, worktreePath, opts, totalCost);
    } finally {
      // Restore PATH whether or not we bailed.
      if (pathPrefix && origPath !== undefined) {
        process.env.PATH = origPath;
      }
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log.error("swebench", `unhandled error in ${inst.instance_id}: ${message}`);
    try {
      void finishRun(runId, "failed");
    } catch {
      // best-effort
    }
    return {
      instance_id: inst.instance_id,
      model_patch: "",
      outcome: "failed",
      costUsd: totalCost,
    };
  } finally {
    if (worktreePath !== null) {
      await cleanupCheckout(inst.repo, runId).catch((e) =>
        log.warn("swebench", `cleanup failed for run ${runId}: ${e}`),
      );
    }
  }
}

async function runInstanceInner(
  inst: SwebenchInstance,
  issue: IssueForPrompt,
  runId: string,
  worktreePath: string,
  opts: Pick<HarnessOpts, "perRunCap" | "noVenv" | "stripPatterns">,
  _totalCost: number,
): Promise<InstanceResult> {
  let totalCost = _totalCost;
  const { perRunCap, stripPatterns } = opts;

  // Step 5: UNDERSTAND
  const undResult = await runUnderstand({
    runId,
    issue,
    cwd: worktreePath,
    costBudgetUsd: perRunCap,
  });

  if (!undResult.ok) {
    void incRunCost(runId, undResult.partialCostUsd);
    totalCost += undResult.partialCostUsd;
    void finishRun(runId, "failed");
    return emptyPatch(inst, totalCost, "failed");
  }

  void incRunCost(runId, undResult.costUsd);
  totalCost += undResult.costUsd;
  const understanding = undResult.understanding;
  void updateRunStatus(runId, "planning", {
    issue_type: understanding.issue_type,
    understanding_json: JSON.stringify(understanding),
  });
  void saveRunArtifact(runId, "understanding", JSON.stringify(understanding, null, 2));

  if (
    !understanding.proceed ||
    understanding.confidence_to_proceed < botConfig.understanding.minConfidenceToProceed
  ) {
    // No GitHub comment. Log and return empty patch (counts as unresolved).
    const reason =
      understanding.abort_reason ??
      `confidence ${understanding.confidence_to_proceed} < ${botConfig.understanding.minConfidenceToProceed}`;
    log.info("swebench", `${inst.instance_id}: understand abort — ${reason}`);
    void finishRun(runId, "abandoned");
    return emptyPatch(inst, totalCost, "abandoned");
  }

  // Step 6: REPRODUCE or DESIGN
  let reproTestPath: string | null = null;
  let designJson: string | null = null;

  if (understanding.issue_type === "bug") {
    const repro = await runReproduce({
      runId,
      issue,
      understanding,
      cwd: worktreePath,
      costBudgetUsd: perRunCap,
    });

    if (!repro.ok) {
      void incRunCost(runId, repro.partialCostUsd);
      totalCost += repro.partialCostUsd;
      // SWE-bench: don't abandon on repro failure — fall through to plan.
      log.warn("swebench", `${inst.instance_id}: reproduce failed — ${repro.error}`);
    } else {
      void incRunCost(runId, repro.costUsd);
      totalCost += repro.costUsd;
      void saveRunArtifact(runId, "reproduce", JSON.stringify(repro.reproduce, null, 2));
      if (repro.reproduce.reproduced) {
        reproTestPath = repro.reproduce.test_file_path;
      } else {
        // Cannot reproduce: log and continue (unlike GitHub Otis which abandons).
        const why = repro.reproduce.cannot_reproduce_reason ?? "no reason given";
        log.info("swebench", `${inst.instance_id}: cannot reproduce — ${why}`);
      }
    }
  } else if (understanding.issue_type === "feature") {
    const design = await runDesign({
      runId,
      issue,
      understanding,
      cwd: worktreePath,
      costBudgetUsd: perRunCap,
    });

    if (!design.ok) {
      void incRunCost(runId, design.partialCostUsd);
      totalCost += design.partialCostUsd;
      log.warn("swebench", `${inst.instance_id}: design failed — ${design.error}`);
    } else {
      void incRunCost(runId, design.costUsd);
      totalCost += design.costUsd;
      designJson = JSON.stringify(design.design, null, 2);
      void saveRunArtifact(runId, "design", designJson);
    }
  }

  // Step 7: PLAN
  emitEvent(runId, "plan.started", {});
  const planStartedAt = Date.now();
  const planRes = await runStructuredPlan({
    runId,
    prompt: planPromptV2({
      issue,
      understanding: asUnderstandingForPrompt(understanding),
      reproTestPath,
      designJson,
    }),
    cwd: worktreePath,
    schema: PlanSchema,
    jsonSchema: PLAN_V2_JSON_SCHEMA,
    costBudgetUsd: perRunCap,
    allowedTools: ["Read", "Grep", "Glob"],
    permissionMode: "dontAsk",
  });
  recordPhaseCost({
    runId,
    phase: "plan",
    costUsd: planRes.ok ? planRes.costUsd : (planRes.partialCostUsd ?? 0),
    durationMs: Date.now() - planStartedAt,
    ok: planRes.ok,
  });

  if (!planRes.ok) {
    void incRunCost(runId, planRes.partialCostUsd ?? 0);
    totalCost += planRes.partialCostUsd ?? 0;
    emitEvent(runId, "plan.aborted", { reason: planRes.error });
    void finishRun(runId, "failed");
    return emptyPatch(inst, totalCost, "failed");
  }

  void incRunCost(runId, planRes.costUsd);
  totalCost += planRes.costUsd;
  emitEvent(runId, "plan.completed", {
    complexity: planRes.plan.complexity,
    filesPlanned: planRes.plan.files_to_change.length,
  });
  void saveRunArtifact(runId, "plan", JSON.stringify(planRes.plan, null, 2));

  if (planRes.plan.should_abort) {
    const reason = planRes.plan.abort_reason ?? "no reason given";
    log.info("swebench", `${inst.instance_id}: plan abort — ${reason}`);
    void finishRun(runId, "abandoned");
    return emptyPatch(inst, totalCost, "abandoned");
  }

  // Step 8: Init iteration state
  void updateRunStatus(runId, "implementing");
  emitEvent(runId, "run.status", { status: "implementing" });

  let attempt = 0;
  let replanCount = 0;
  let currentPlan = planRes.plan;
  let lastSessionId: string | undefined;
  let lastVerdict: Awaited<ReturnType<typeof runVerification>> | null = null;
  let acceptancePaths = computeAcceptancePaths(currentPlan, reproTestPath);

  // Step 9: IMPLEMENT↔VERIFY loop
  while (attempt < botConfig.verification.maxIterations) {
    attempt++;

    const prompt =
      attempt === 1
        ? implementPromptV2({
            issue,
            understanding: asUnderstandingForPrompt(understanding),
            plan: currentPlan,
            reproTestPath,
          })
        : iterationPrompt(verdictForRetry(lastVerdict!), JSON.stringify(currentPlan, null, 2));

    if (attempt > 1) {
      emitEvent(runId, "iteration.started", { attempt });
      void updateRunStatus(runId, "iterating");
    } else {
      emitEvent(runId, "implement.started", {});
    }

    const implStartedAt = Date.now();
    const impl = await runClaudeCode({
      runId,
      mode: "implement",
      prompt,
      cwd: worktreePath,
      allowedTools: botConfig.allowedTools,
      permissionMode: "acceptEdits",
      resumeSessionId: lastSessionId,
      costBudgetUsd: perRunCap,
    });

    if (impl.ok) lastSessionId = impl.sessionId;
    const implCost = impl.ok ? impl.costUsd : (impl.partialCostUsd ?? 0);
    void incRunCost(runId, implCost);
    totalCost += implCost;
    recordPhaseCost({
      runId,
      phase: "implement",
      attempt,
      costUsd: implCost,
      durationMs: Date.now() - implStartedAt,
      ok: impl.ok,
    });

    // Replan branch
    if (impl.ok && impl.result) {
      const requests = parseImplementerRequests(impl.result);
      const revision = requests.find((r) => r.kind === "plan_revision");
      if (revision && replanCount < botConfig.replan.maxPerRun) {
        replanCount++;
        const replanRes = await runReplan({
          runId,
          issue,
          understanding,
          originalPlan: currentPlan,
          discovered: revision.discovered,
          suggestedNewFiles: revision.suggestedNewFiles,
          attempt: replanCount,
          cwd: worktreePath,
          costBudgetUsd: perRunCap,
        });
        if (replanRes.ok) {
          void incRunCost(runId, replanRes.costUsd);
          totalCost += replanRes.costUsd;
          currentPlan = replanRes.plan as Plan;
          acceptancePaths = computeAcceptancePaths(currentPlan, reproTestPath);
          void saveRunArtifact(runId, `replan-${replanCount}`, JSON.stringify(currentPlan, null, 2));
          attempt--;
          continue;
        }
        if (replanRes.partialCostUsd) {
          void incRunCost(runId, replanRes.partialCostUsd);
          totalCost += replanRes.partialCostUsd;
        }
        log.warn("swebench", `${inst.instance_id}: replan ${replanCount} failed — ${replanRes.error}`);
      }
    }

    if (!impl.ok) {
      // Non-retryable failure. Still capture whatever diff exists below.
      emitEvent(runId, "implement.failed", {
        kind: impl.errorKind,
        message: impl.errorMessage,
      });
      break;
    }

    emitEvent(runId, "implement.completed", {});

    // VERIFY
    void updateRunStatus(runId, "verifying");
    const verifyStartedAt = Date.now();
    lastVerdict = await runVerification({
      runId,
      attempt,
      cwd: worktreePath,
      // baseRef = the exact SHA (detached checkout; origin/<branch> may not exist).
      baseRef: inst.base_commit,
      plan: currentPlan,
      issue,
      understanding,
      acceptancePaths,
      useCriticV2: false,
    });
    recordPhaseCost({
      runId,
      phase: "verify",
      attempt,
      costUsd: 0,
      durationMs: Date.now() - verifyStartedAt,
      ok: lastVerdict.pass,
    });

    // Bail if mutation-light corrupted the worktree.
    const mutDetail = lastVerdict.checks.mutation_light?.detail as
      | { popStderr?: string; broken?: boolean }
      | undefined;
    if (mutDetail?.popStderr || mutDetail?.broken) {
      emitEvent(runId, "run.worktree_broken", { detail: mutDetail });
      break;
    }

    if (lastVerdict.pass) break;
  }

  // Steps 11-12: capture + strip patch unconditionally (never block on verdict).
  const rawPatch = await captureModelPatch(worktreePath, inst.base_commit, stripPatterns);
  const modelPatch = rawPatch;

  if (rawPatch) {
    void saveRunArtifact(runId, "diff", rawPatch);
    void saveRunArtifact(runId, "model_patch", modelPatch);
  }

  // Step 13: finish in a terminal status.
  const outcome = modelPatch ? "succeeded" : "abandoned";
  void finishRun(runId, outcome);

  return {
    instance_id: inst.instance_id,
    model_patch: modelPatch,
    outcome,
    costUsd: totalCost,
  };
}

function emptyPatch(
  inst: SwebenchInstance,
  costUsd: number,
  outcome: "abandoned" | "failed",
): InstanceResult {
  return { instance_id: inst.instance_id, model_patch: "", outcome, costUsd };
}
