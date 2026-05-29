/* eslint-disable no-console */
import { botConfig } from "../../bot.config";
import { db } from "../db";
import { ensureSchema } from "../db/migrate";
import { runImplementer } from "./implementer";
import { runReviewer } from "./reviewer";
import { reapOrphans, recoverCrashedRuns } from "./worktree";
import { listLabeledIssues } from "../github/client";
import { log } from "../shared/logger";

const POLL_INTERVAL_MS = 60_000;
const REVIEWER_INTERVAL_MS = botConfig.reviewer.intervalMinutes * 60_000;

async function pollOnce() {
  for (const repoCfg of botConfig.repos) {
    if (!repoCfg.enabled) continue;
    let issues;
    try {
      issues = await listLabeledIssues({
        owner: repoCfg.owner,
        repo: repoCfg.name,
        label: botConfig.labels.request,
      });
    } catch (err) {
      log.warn("coord", `polling ${repoCfg.owner}/${repoCfg.name} failed: ${err}`);
      continue;
    }
    for (const issue of issues) {
      const claimed = issue.labels.includes(botConfig.labels.claimed);
      if (claimed) continue;
      const existingRun = db
        .prepare(
          `SELECT id FROM runs WHERE repo=? AND issue_number=? AND status NOT IN ('failed','abandoned')`,
        )
        .get(`${repoCfg.owner}/${repoCfg.name}`, issue.number) as { id: number } | undefined;
      if (existingRun) continue;

      // Need REPO_DIR set per-repo for worktree creation. v0: env-driven.
      const repoDir = process.env.REPO_DIR;
      if (!repoDir) {
        log.warn("coord", `REPO_DIR not set — cannot create worktree for ${repoCfg.owner}/${repoCfg.name}#${issue.number}`);
        continue;
      }
      try {
        await runImplementer({
          repoDir,
          owner: repoCfg.owner,
          repo: repoCfg.name,
          baseBranch: repoCfg.defaultBranch,
          issue: {
            number: issue.number,
            title: issue.title,
            body: issue.body,
            labels: issue.labels,
          },
        });
      } catch (err) {
        log.error("coord", `implementer threw on ${repoCfg.owner}/${repoCfg.name}#${issue.number}: ${err}`);
      }
    }
  }
}

async function reviewerOnce() {
  if (!botConfig.reviewer.enabled) return;
  for (const repoCfg of botConfig.repos) {
    if (!repoCfg.enabled) continue;
    const repoDir = process.env.REPO_DIR;
    if (!repoDir) continue;
    try {
      const result = await runReviewer({
        repoDir,
        owner: repoCfg.owner,
        repo: repoCfg.name,
      });
      log.info(
        "coord",
        `reviewer ran on ${repoCfg.owner}/${repoCfg.name}: proposed=${result.proposed} opened=${result.opened} deduped=${result.deduped}`,
      );
    } catch (err) {
      log.error("coord", `reviewer failed: ${err}`);
    }
  }
}

async function main() {
  ensureSchema();
  const repoDir = process.env.REPO_DIR;
  if (repoDir) {
    const recovered = await recoverCrashedRuns(repoDir);
    if (recovered) log.info("coord", `recovered ${recovered} crashed run(s)`);
    await reapOrphans(repoDir);
  }

  log.info("coord", "42n-bot coordinator started");

  // Initial pass + then poll forever.
  await pollOnce();
  await reviewerOnce();

  setInterval(() => {
    pollOnce().catch((err) => log.error("coord", `poll error: ${err}`));
  }, POLL_INTERVAL_MS);

  setInterval(() => {
    reviewerOnce().catch((err) => log.error("coord", `reviewer error: ${err}`));
  }, REVIEWER_INTERVAL_MS);

  setInterval(() => {
    if (repoDir) reapOrphans(repoDir).catch((err) => log.error("coord", `reap error: ${err}`));
  }, 6 * 60 * 60_000);
}

if (typeof require !== "undefined" && require.main === module) {
  main().catch((err) => {
    log.error("coord", `fatal: ${err}`);
    process.exit(1);
  });
}

export { main };
