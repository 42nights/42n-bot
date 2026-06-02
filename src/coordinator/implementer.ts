import simpleGit from "simple-git";
import { botConfig } from "../../bot.config";
import { emitDeploymentEvent } from "../castle/events";
import { runClaudeCode, runStructuredPlan } from "../claude/runner";
import {
  PLAN_V2_JSON_SCHEMA,
  implementPromptV2,
  iterationPrompt,
  planPromptV2,
  PROMPT_VERSION,
  type IssueForPrompt,
  type UnderstandingForPrompt,
} from "../claude/prompts";
import { z } from "zod";
import { assertNotProtected, createWorktree, removeWorktree } from "./worktree";
import { runVerification } from "../verification";
import type { Plan, Verdict } from "../verification/types";
import { renderPrBody } from "./pr-body";
import { runUnderstand } from "../claude/phases/understand";
import { runReproduce } from "../claude/phases/reproduce";
import { runDesign } from "../claude/phases/design";
import { runReplan } from "../claude/phases/replan";
import { parseImplementerRequests } from "../claude/parse-requests";
import { recordPhaseCost } from "../claude/phases/cost-tracker";
import type { Understanding, CriticV2Report } from "../claude/phases/types";
import {
  addLabel,
  commentOnIssue,
  openPullRequest,
  removeLabel,
} from "../github/client";
import { emitEvent } from "../shared/events";
import { log } from "../shared/logger";
import { dayBudgetOk, issueBudgetOk } from "./budget";
import { freshPushAuth } from "../repo-clone";
import {
  createRunIfNoActive,
  patchRun,
  incrementRunCost,
  getRunCost,
} from "../db/ops/runs";
import { insertArtifact } from "../db/ops/artifacts";

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

export type ImplementerInput = {
  repoDir: string;
  owner: string;
  repo: string;
  baseBranch: string;
  issue: IssueForPrompt;
};

const IMPLEMENTER_ALLOWED_TOOLS = [
  "Bash(npm *)", "Bash(npx *)", "Bash(node *)", "Bash(pnpm *)",
  "Bash(jest *)", "Bash(vitest *)", "Bash(pytest *)", "Bash(go test *)",
  "Bash(cargo *)", "Bash(tsc *)", "Bash(eslint *)", "Bash(prettier *)",
  "Bash(git status *)", "Bash(git diff *)", "Bash(git log *)",
  "Bash(ls *)", "Bash(cat *)", "Bash(grep *)", "Bash(find *)",
  "Bash(mkdir *)", "Bash(rm -f *)",
  "Read", "Edit", "Write", "Glob", "Grep",
];

async function createRunRow(input: ImplementerInput): Promise<string | null> {
  const repoFull = `${input.owner}/${input.repo}`;
  return createRunIfNoActive({
    type: "implement",
    repo: repoFull,
    issue_number: input.issue.number,
    issue_title: input.issue.title,
    issue_body: input.issue.body,
    status: "queued",
    started_at: Date.now(),
  });
}

function updateRun(runId: string, patch: Record<string, unknown>): void {
  patchRun(runId, patch).catch((err) =>
    log.error("implementer", `updateRun(${runId}) failed: ${err}`),
  );
}

function incCost(runId: string, deltaUsd: number): void {
  incrementRunCost(runId, deltaUsd).catch((err) =>
    log.error("implementer", `incCost(${runId}) failed: ${err}`),
  );
}

function saveArtifact(runId: string, kind: string, content: string): void {
  insertArtifact(runId, kind, content).catch((err) =>
    log.error("implementer", `saveArtifact(${runId}, ${kind}) failed: ${err}`),
  );
}

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

async function cleanupLabels(args: {
  owner: string;
  repo: string;
  issue_number: number;
  alsoRemovePlease: boolean;
}) {
  await Promise.allSettled([
    removeLabel({
      owner: args.owner,
      repo: args.repo,
      issue_number: args.issue_number,
      label: botConfig.labels.claimed,
    }),
    args.alsoRemovePlease
      ? removeLabel({
          owner: args.owner,
          repo: args.repo,
          issue_number: args.issue_number,
          label: botConfig.labels.request,
        })
      : Promise.resolve(),
  ]);
}

export async function runImplementer(input: ImplementerInput): Promise<{
  runId: string;
  outcome: "succeeded" | "needs-review" | "abandoned" | "failed";
  prNumber?: number;
  prUrl?: string;
}> {
  const day = await dayBudgetOk();
  if (!day.ok) {
    log.warn(
      "implementer",
      `daily budget exceeded ($${day.spentUsd.toFixed(2)}) — skipping issue #${input.issue.number}`,
    );
    throw new Error(`Daily budget exceeded ($${day.spentUsd.toFixed(2)})`);
  }
  const issueBudget = await issueBudgetOk(
    `${input.owner}/${input.repo}`,
    input.issue.number,
  );
  if (!issueBudget.ok) {
    log.warn(
      "implementer",
      `per-issue budget exceeded for #${input.issue.number}: ` +
        `$${issueBudget.spentUsd.toFixed(2)} across ${issueBudget.priorRuns} prior run(s)`,
    );
    throw new Error(
      `Per-issue budget exceeded for #${input.issue.number}`,
    );
  }

  const runId = await createRunRow(input);
  if (runId === null) {
    log.info(
      "implementer",
      `${input.owner}/${input.repo}#${input.issue.number} already has an active run — skipping`,
    );
    return { runId: "", outcome: "abandoned" };
  }
  emitEvent(runId, "run.created", {
    type: "implement",
    issue: input.issue.number,
  });
  emitDeploymentEvent({
    kind: "session_started",
    session_id: runId,
    issue_url: `https://github.com/${input.owner}/${input.repo}/issues/${input.issue.number}`,
    created_at: new Date().toISOString(),
  }).catch(() => {});

  await addLabel({
    owner: input.owner,
    repo: input.repo,
    issue_number: input.issue.number,
    label: botConfig.labels.claimed,
  }).catch((err) =>
    log.warn("implementer", `could not apply bot-claimed: ${err}`),
  );

  updateRun(runId, { status: "planning" });
  emitEvent(runId, "run.status", { status: "planning" });

  let worktreePath: string | null = null;
  let branch: string | null = null;
  let pushToken: string | null = null;

  try {
    const wt = await createWorktree({
      repoDir: input.repoDir,
      issueNumber: input.issue.number,
      baseBranch: input.baseBranch,
    });
    branch = wt.branch;
    worktreePath = wt.worktreePath;
    assertNotProtected(branch);
    updateRun(runId, { branch_name: branch, worktree_path: worktreePath });

    const undResult = await runUnderstand({
      runId,
      issue: input.issue,
      cwd: worktreePath,
      costBudgetUsd: botConfig.budgets.perRunUsd,
    });
    if (!undResult.ok) {
      if (undResult.partialCostUsd) incCost(runId, undResult.partialCostUsd);
      updateRun(runId, {
        status: "failed",
        finished_at: Date.now(),
        error_message: `understand failed: ${undResult.error}`,
      });
      await cleanupLabels({
        owner: input.owner,
        repo: input.repo,
        issue_number: input.issue.number,
        alsoRemovePlease: false,
      });
      if (worktreePath)
        await removeWorktree({ repoDir: input.repoDir, worktreePath, force: true });
      return { runId, outcome: "failed" };
    }
    incCost(runId, undResult.costUsd);
    const understanding = undResult.understanding;
    updateRun(runId, {
      issue_type: understanding.issue_type,
      understanding_json: JSON.stringify(understanding),
    });
    saveArtifact(runId, "understanding", JSON.stringify(understanding, null, 2));

    if (
      !understanding.proceed ||
      understanding.confidence_to_proceed <
        botConfig.understanding.minConfidenceToProceed
    ) {
      const reason =
        understanding.abort_reason ??
        `Confidence ${understanding.confidence_to_proceed} below threshold ${botConfig.understanding.minConfidenceToProceed}.`;
      const unknownsBlock = understanding.unknowns.length
        ? `\n\n**Unknowns:**\n${understanding.unknowns.map((u) => `- ${u}`).join("\n")}`
        : "";
      await commentOnIssue({
        owner: input.owner,
        repo: input.repo,
        issue_number: input.issue.number,
        body: `🤖 Otis examined this issue and chose not to attempt an implementation.\n\n**Reason:** ${reason}${unknownsBlock}\n\n_Re-apply \`bot-please\` once the issue is clarified to have me try again._`,
      }).catch(() => {});
      await addLabel({
        owner: input.owner,
        repo: input.repo,
        issue_number: input.issue.number,
        label: botConfig.labels.needsInfo,
      }).catch(() => {});
      await cleanupLabels({
        owner: input.owner,
        repo: input.repo,
        issue_number: input.issue.number,
        alsoRemovePlease: true,
      });
      updateRun(runId, {
        status: "abandoned",
        finished_at: Date.now(),
        error_message: `understand abort: ${reason}`,
      });
      emitEvent(runId, "run.finished", { outcome: "abandoned" });
      await removeWorktree({ repoDir: input.repoDir, worktreePath, force: true });
      return { runId, outcome: "abandoned" };
    }

    let reproTestPath: string | null = null;
    let designJson: string | null = null;
    if (understanding.issue_type === "bug") {
      const repro = await runReproduce({
        runId,
        issue: input.issue,
        understanding,
        cwd: worktreePath,
        costBudgetUsd: botConfig.budgets.perRunUsd,
      });
      if (!repro.ok) {
        if (repro.partialCostUsd) incCost(runId, repro.partialCostUsd);
        log.warn("implementer", `reproduce failed: ${repro.error}`);
      } else {
        incCost(runId, repro.costUsd);
        saveArtifact(runId, "reproduce", JSON.stringify(repro.reproduce, null, 2));
        if (repro.reproduce.reproduced) {
          reproTestPath = repro.reproduce.test_file_path;
        } else {
          const why = repro.reproduce.cannot_reproduce_reason ?? "no reason given";
          await commentOnIssue({
            owner: input.owner,
            repo: input.repo,
            issue_number: input.issue.number,
            body: `🤖 Otis attempted to reproduce this but couldn't.\n\n**Reason:** ${why}\n\nTo proceed, I need one of:\n- Exact repro steps (command, input, expected output, actual output)\n- The version / commit hash where you observed this\n- Confirmation that this is still happening on \`main\``,
          }).catch(() => {});
          await Promise.allSettled([
            addLabel({
              owner: input.owner,
              repo: input.repo,
              issue_number: input.issue.number,
              label: botConfig.labels.cantReproduce,
            }),
          ]);
          await cleanupLabels({
            owner: input.owner,
            repo: input.repo,
            issue_number: input.issue.number,
            alsoRemovePlease: true,
          });
          updateRun(runId, {
            status: "abandoned",
            finished_at: Date.now(),
            error_message: `cannot reproduce: ${why}`,
          });
          emitEvent(runId, "run.finished", { outcome: "abandoned" });
          await removeWorktree({ repoDir: input.repoDir, worktreePath, force: true });
          return { runId, outcome: "abandoned" };
        }
      }
    } else if (understanding.issue_type === "feature") {
      const design = await runDesign({
        runId,
        issue: input.issue,
        understanding,
        cwd: worktreePath,
        costBudgetUsd: botConfig.budgets.perRunUsd,
      });
      if (!design.ok) {
        if (design.partialCostUsd) incCost(runId, design.partialCostUsd);
        log.warn("implementer", `design failed: ${design.error}`);
      } else {
        incCost(runId, design.costUsd);
        designJson = JSON.stringify(design.design, null, 2);
        saveArtifact(runId, "design", designJson);
      }
    }

    emitEvent(runId, "plan.started", {});
    const planStartedAt = Date.now();
    const planRes = await runStructuredPlan({
      runId,
      prompt: planPromptV2({
        issue: input.issue,
        understanding: asUnderstandingForPrompt(understanding),
        reproTestPath,
        designJson,
      }),
      cwd: worktreePath,
      schema: PlanSchema,
      jsonSchema: PLAN_V2_JSON_SCHEMA,
      costBudgetUsd: botConfig.budgets.perRunUsd,
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
      if (planRes.partialCostUsd) incCost(runId, planRes.partialCostUsd);
      emitEvent(runId, "plan.aborted", { reason: planRes.error });
      updateRun(runId, {
        status: "failed",
        finished_at: Date.now(),
        error_message: planRes.error,
      });
      await cleanupLabels({
        owner: input.owner,
        repo: input.repo,
        issue_number: input.issue.number,
        alsoRemovePlease: false,
      });
      if (worktreePath)
        await removeWorktree({ repoDir: input.repoDir, worktreePath, force: true });
      return { runId, outcome: "failed" };
    }
    incCost(runId, planRes.costUsd);
    saveArtifact(runId, "plan", JSON.stringify(planRes.plan, null, 2));
    emitEvent(runId, "plan.completed", {
      complexity: planRes.plan.complexity,
      filesPlanned: planRes.plan.files_to_change.length,
      testsPlanned: planRes.plan.tests_to_add_or_update.length,
    });

    if (planRes.plan.should_abort) {
      const reason = planRes.plan.abort_reason ?? "no reason given";
      await commentOnIssue({
        owner: input.owner,
        repo: input.repo,
        issue_number: input.issue.number,
        body: `🤖 The bot examined this issue and chose not to attempt an implementation.\n\n**Reason:** ${reason}`,
      }).catch(() => {});
      await cleanupLabels({
        owner: input.owner,
        repo: input.repo,
        issue_number: input.issue.number,
        alsoRemovePlease: false,
      });
      updateRun(runId, {
        status: "abandoned",
        finished_at: Date.now(),
        error_message: `plan abort: ${reason}`,
      });
      emitEvent(runId, "run.finished", { outcome: "abandoned" });
      await removeWorktree({ repoDir: input.repoDir, worktreePath, force: true });
      return { runId, outcome: "abandoned" };
    }

    updateRun(runId, { status: "implementing" });
    emitEvent(runId, "run.status", { status: "implementing" });
    let lastSessionId: string | undefined;
    let lastVerdict: Awaited<ReturnType<typeof runVerification>> | null = null;
    let attempt = 0;
    let replanCount = 0;
    let currentPlan = planRes.plan;
    const computeAcceptancePaths = (plan: Plan): string[] => {
      const set = new Set<string>([
        ...(reproTestPath ? [reproTestPath] : []),
        ...((plan.acceptance_test_paths ?? []) as string[]),
      ]);
      return Array.from(set);
    };
    let acceptancePaths = computeAcceptancePaths(currentPlan);
    updateRun(runId, {
      acceptance_test_paths_json: JSON.stringify(acceptancePaths),
    });

    while (attempt < botConfig.verification.maxIterations) {
      attempt += 1;
      updateRun(runId, { attempts: attempt });

      const prompt =
        attempt === 1
          ? implementPromptV2({
              issue: input.issue,
              understanding: asUnderstandingForPrompt(understanding),
              plan: currentPlan,
              reproTestPath,
            })
          : iterationPrompt(
              verdictForRetry(lastVerdict!),
              JSON.stringify(currentPlan, null, 2),
            );

      if (attempt > 1) {
        emitEvent(runId, "iteration.started", { attempt });
        updateRun(runId, { status: "iterating" });
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
        costBudgetUsd: botConfig.budgets.perRunUsd,
      });
      if (impl.ok) lastSessionId = impl.sessionId;
      incCost(runId, impl.ok ? impl.costUsd : (impl.partialCostUsd ?? 0));
      recordPhaseCost({
        runId,
        phase: "implement",
        attempt,
        costUsd: impl.ok ? impl.costUsd : (impl.partialCostUsd ?? 0),
        durationMs: Date.now() - implStartedAt,
        ok: impl.ok,
      });

      if (impl.ok && impl.result) {
        const requests = parseImplementerRequests(impl.result);
        const revision = requests.find((r) => r.kind === "plan_revision");
        if (revision && replanCount < botConfig.replan.maxPerRun) {
          replanCount += 1;
          updateRun(runId, { replan_count: replanCount });
          log.info(
            "implementer",
            `implementer requested replan (${replanCount}/${botConfig.replan.maxPerRun}): ${revision.discovered.slice(0, 120)}`,
          );
          const replanRes = await runReplan({
            runId,
            issue: input.issue,
            understanding,
            originalPlan: currentPlan,
            discovered: revision.discovered,
            suggestedNewFiles: revision.suggestedNewFiles,
            attempt: replanCount,
            cwd: worktreePath,
            costBudgetUsd: botConfig.budgets.perRunUsd,
          });
          if (replanRes.ok) {
            incCost(runId, replanRes.costUsd);
            currentPlan = replanRes.plan as Plan;
            acceptancePaths = computeAcceptancePaths(currentPlan);
            updateRun(runId, {
              acceptance_test_paths_json: JSON.stringify(acceptancePaths),
            });
            saveArtifact(
              runId,
              `replan-${replanCount}`,
              JSON.stringify(currentPlan, null, 2),
            );
            attempt -= 1;
            continue;
          }
          if (replanRes.partialCostUsd)
            incCost(runId, replanRes.partialCostUsd);
          log.warn("implementer", `replan failed: ${replanRes.error}`);
        }
      }

      if (!impl.ok) {
        emitEvent(runId, "implement.failed", {
          kind: impl.errorKind,
          message: impl.errorMessage,
        });
        updateRun(runId, {
          status: "failed",
          finished_at: Date.now(),
          error_message: `${impl.errorKind}: ${impl.errorMessage}`,
        });
        await cleanupLabels({
          owner: input.owner,
          repo: input.repo,
          issue_number: input.issue.number,
          alsoRemovePlease: false,
        });
        await removeWorktree({ repoDir: input.repoDir, worktreePath, force: true });
        return { runId, outcome: "failed" };
      }
      emitEvent(runId, "implement.completed", {});

      updateRun(runId, { status: "verifying" });
      const verifyStartedAt = Date.now();
      lastVerdict = await runVerification({
        runId,
        attempt,
        cwd: worktreePath,
        baseRef: `origin/${input.baseBranch}`,
        plan: currentPlan,
        issue: input.issue,
        understanding,
        acceptancePaths,
        useCriticV2: true,
      });
      recordPhaseCost({
        runId,
        phase: "verify",
        attempt,
        costUsd: 0,
        durationMs: Date.now() - verifyStartedAt,
        ok: lastVerdict.pass,
      });

      const mutationDetail = lastVerdict.checks.mutation_light.detail as
        | { popStderr?: string; broken?: boolean }
        | undefined;
      if (mutationDetail?.popStderr || mutationDetail?.broken) {
        emitEvent(runId, "run.worktree_broken", { detail: mutationDetail });
        updateRun(runId, {
          status: "failed",
          finished_at: Date.now(),
          error_message: "worktree state corrupted during mutation check",
        });
        emitDeploymentEvent({
          kind: "verification_failed",
          session_id: runId,
          phase: "mutation_light",
          reason: "worktree state corrupted during mutation check",
        }).catch(() => {});
        emitDeploymentEvent({
          kind: "session_ended",
          session_id: runId,
          status: "failed",
        }).catch(() => {});
        await cleanupLabels({
          owner: input.owner,
          repo: input.repo,
          issue_number: input.issue.number,
          alsoRemovePlease: false,
        });
        await removeWorktree({ repoDir: input.repoDir, worktreePath, force: true });
        return { runId, outcome: "failed" };
      }

      if (lastVerdict.pass) break;
    }

    const needsReview = !lastVerdict?.pass;

    const git = simpleGit(worktreePath);
    await git.add(["-A", "--", ".", ":(exclude)node_modules"]);
    const status = await git.status();
    if (!status.files.length) {
      updateRun(runId, {
        status: "failed",
        finished_at: Date.now(),
        error_message: "no diff produced",
      });
      await cleanupLabels({
        owner: input.owner,
        repo: input.repo,
        issue_number: input.issue.number,
        alsoRemovePlease: false,
      });
      await removeWorktree({ repoDir: input.repoDir, worktreePath, force: true });
      return { runId, outcome: "failed" };
    }
    const summary =
      understanding.user_visible_outcome || currentPlan.user_visible_change;
    await git.commit(
      `bot: ${input.issue.title}\n\nCloses #${input.issue.number}\n\n${summary}\n\nPrompt-version: ${PROMPT_VERSION}`,
    );

    const { url: pushUrl, token } = await freshPushAuth(input.owner, input.repo);
    pushToken = token;
    try {
      await git.push(pushUrl, `${branch!}:${branch!}`);
    } catch (err) {
      const raw = err instanceof Error ? err.message : String(err);
      const scrubbed = pushToken ? raw.replaceAll(pushToken, "<token>") : raw;
      throw new Error(`push failed: ${scrubbed}`);
    }

    const costUsd = await getRunCost(runId);

    const runtimeCheck = lastVerdict!.checks.runtime_verification;
    const runtimeVerification = runtimeCheck
      ? { ok: runtimeCheck.pass, summary: runtimeCheck.message }
      : null;
    updateRun(runId, {
      runtime_verification_json: runtimeCheck
        ? JSON.stringify({
            pass: runtimeCheck.pass,
            message: runtimeCheck.message,
            detail: runtimeCheck.detail,
          })
        : null,
    });

    const prBody = renderPrBody({
      issue: input.issue,
      plan: currentPlan,
      verdict: lastVerdict!,
      attempts: attempt,
      runId,
      costUsd,
      needsReview,
      understanding,
      criticV2: lastVerdict!.criticV2,
      runtimeVerification,
    });

    const pr = await openPullRequest({
      owner: input.owner,
      repo: input.repo,
      head: branch!,
      base: input.baseBranch,
      title: `bot: ${input.issue.title}`,
      body: prBody,
      labels: needsReview ? [botConfig.labels.needsReview] : [],
    });

    updateRun(runId, {
      pr_number: pr.number,
      pr_url: pr.url,
      status: needsReview ? "needs-review" : "pr-opened",
      finished_at: Date.now(),
    });
    emitEvent(runId, needsReview ? "pr.needs_review" : "pr.opened", {
      number: pr.number,
      url: pr.url,
    });
    emitEvent(runId, "run.finished", {
      outcome: needsReview ? "needs-review" : "pr-opened",
    });
    emitDeploymentEvent({
      kind: "pr_opened",
      session_id: runId,
      pr_url: pr.url,
      outcome: needsReview ? "needs_review" : "passing",
    }).catch(() => {});
    emitDeploymentEvent({
      kind: "session_ended",
      session_id: runId,
      status: needsReview ? "failed" : "succeeded",
    }).catch(() => {});

    await cleanupLabels({
      owner: input.owner,
      repo: input.repo,
      issue_number: input.issue.number,
      alsoRemovePlease: true,
    });

    if (needsReview) {
      const whyBlock = lastVerdict?.failureSummary
        ? `\n\n**What didn't pass cleanly:**\n${lastVerdict.failureSummary
            .split("\n")
            .slice(0, 6)
            .join("\n")}`
        : "";
      await commentOnIssue({
        owner: input.owner,
        repo: input.repo,
        issue_number: input.issue.number,
        body: `🤖 I attempted this issue but couldn't fully satisfy the verification harness after ${attempt} attempts. Opened PR #${pr.number} for human review — full verification report is in the PR body.${whyBlock}`,
      }).catch(() => {});
    }

    await removeWorktree({
      repoDir: input.repoDir,
      worktreePath,
      force: true,
    }).catch((err) =>
      log.warn("implementer", `worktree cleanup after PR failed: ${err}`),
    );

    return {
      runId,
      outcome: needsReview ? "needs-review" : "succeeded",
      prNumber: pr.number,
      prUrl: pr.url,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log.error("implementer", `unhandled error in run ${runId}: ${message}`);
    updateRun(runId, {
      status: "failed",
      finished_at: Date.now(),
      error_message: message,
    });
    emitDeploymentEvent({
      kind: "session_ended",
      session_id: runId,
      status: "failed",
    }).catch(() => {});
    await cleanupLabels({
      owner: input.owner,
      repo: input.repo,
      issue_number: input.issue.number,
      alsoRemovePlease: false,
    });
    if (worktreePath) {
      await removeWorktree({
        repoDir: input.repoDir,
        worktreePath,
        force: true,
      }).catch(() => {});
    }
    return { runId, outcome: "failed" };
  }
}
