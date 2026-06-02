import { z } from "zod";
import { botConfig } from "../../bot.config";
import { runStructuredPlan } from "../claude/runner";
import { REVIEW_JSON_SCHEMA, REVIEW_PROMPT } from "../claude/prompts";
import {
  commentOnIssue,
  createBotIssue,
  listAllOpenIssues,
} from "../github/client";
import { isDuplicate } from "../github/issue-dedupe";
import { emitEvent } from "../shared/events";
import { log } from "../shared/logger";
import { createRun, patchRun, incrementRunCost } from "../db/ops/runs";

const ReviewSchema = z.object({
  candidates: z
    .array(
      z.object({
        type: z.enum([
          "bug",
          "missing-test",
          "code-smell",
          "missing-doc",
          "security",
          "performance",
          "accessibility",
        ]),
        title: z.string(),
        files: z.array(z.string()),
        lines: z.array(z.string()).optional(),
        why_matters: z.string(),
        suggested_fix: z.string(),
        severity: z.enum(["low", "medium", "high"]),
      }),
    )
    .max(5),
});

export type ReviewerInput = {
  repoDir: string;
  owner: string;
  repo: string;
};

const reviewerInFlight = new Set<string>();

export async function runReviewer(input: ReviewerInput): Promise<{
  runId: string;
  proposed: number;
  opened: number;
  deduped: number;
}> {
  const repoKey = `${input.owner}/${input.repo}`;
  if (reviewerInFlight.has(repoKey)) {
    return { runId: "", proposed: 0, opened: 0, deduped: 0 };
  }
  reviewerInFlight.add(repoKey);
  try {
    return await runReviewerInner(input);
  } finally {
    reviewerInFlight.delete(repoKey);
  }
}

async function runReviewerInner(input: ReviewerInput): Promise<{
  runId: string;
  proposed: number;
  opened: number;
  deduped: number;
}> {
  const runId = await createRun({
    type: "review",
    repo: `${input.owner}/${input.repo}`,
    status: "planning",
    started_at: Date.now(),
  });
  emitEvent(runId, "review.started", { repo: `${input.owner}/${input.repo}` });

  const planRes = await runStructuredPlan({
    runId,
    prompt: REVIEW_PROMPT,
    cwd: input.repoDir,
    schema: ReviewSchema,
    jsonSchema: REVIEW_JSON_SCHEMA,
    costBudgetUsd: botConfig.budgets.perRunUsd,
    timeoutMs: botConfig.claudeCode.defaultTimeoutMs,
  });
  if (!planRes.ok) {
    log.warn(
      "reviewer",
      `${input.owner}/${input.repo}: planner failed: ${planRes.error.slice(0, 300)}`,
    );
    await patchRun(runId, {
      status: "failed",
      finished_at: Date.now(),
      error_message: planRes.error,
    });
    return { runId, proposed: 0, opened: 0, deduped: 0 };
  }
  if (planRes.plan.candidates.length === 0) {
    log.info(
      "reviewer",
      `${input.owner}/${input.repo}: Claude returned 0 candidates (nothing worth filing)`,
    );
  }

  await incrementRunCost(runId, planRes.costUsd);

  const existing = await listAllOpenIssues({
    owner: input.owner,
    repo: input.repo,
  });

  const candidates = planRes.plan.candidates.slice(
    0,
    botConfig.reviewer.maxIssuesPerRun,
  );
  emitEvent(runId, "review.proposed", { count: candidates.length });

  const repoFull = `${input.owner}/${input.repo}`;
  let opened = 0;
  let deduped = 0;
  for (const c of candidates) {
    const body = renderReviewIssueBody(c);
    let dupOutcome: Awaited<ReturnType<typeof isDuplicate>>;
    try {
      dupOutcome = await isDuplicate({
        repo: repoFull,
        candidate: { title: c.title, body },
        existing: existing.map((e) => ({
          number: e.number,
          title: e.title,
          body: e.body,
          updated_at: e.updated_at,
        })),
        threshold: botConfig.reviewer.duplicateThreshold,
      });
    } catch (err) {
      log.warn("reviewer", `dedupe failed (proceeding): ${err}`);
      dupOutcome = { duplicate: false };
    }
    if (dupOutcome.duplicate && dupOutcome.nearest) {
      deduped += 1;
      emitEvent(runId, "review.deduped", {
        candidate: c.title,
        existingNumber: dupOutcome.nearest.number,
        score: dupOutcome.nearest.score,
      });
      await commentOnIssue({
        owner: input.owner,
        repo: input.repo,
        issue_number: dupOutcome.nearest.number,
        body: `🤖 Reviewer pass at ${new Date().toISOString()} also identified this issue. No new issue opened to avoid duplicates.`,
      }).catch(() => {});
      continue;
    }
    const created = await createBotIssue({
      owner: input.owner,
      repo: input.repo,
      title: c.title,
      body,
      labels: [botConfig.labels.botFound],
    });
    opened += 1;
    emitEvent(runId, "review.opened_issue", {
      number: created.number,
      url: created.url,
    });
  }

  await patchRun(runId, { status: "succeeded", finished_at: Date.now() });

  return { runId, proposed: candidates.length, opened, deduped };
}

function renderReviewIssueBody(
  c: z.infer<typeof ReviewSchema>["candidates"][number],
): string {
  const lines = c.lines?.length ? `\n**Lines:** ${c.lines.join(", ")}` : "";
  return `**Type:** ${c.type}
**Severity:** ${c.severity}
**Files:** ${c.files.map((f) => `\`${f}\``).join(", ") || "—"}${lines}

## Why it matters
${c.why_matters}

## Suggested fix
${c.suggested_fix}

---
🤖 Found by the 42n-bot reviewer pass.`;
}
