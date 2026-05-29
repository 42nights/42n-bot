/* eslint-disable no-console */
import { botConfig } from "../../bot.config";
import { db } from "../db";
import { ensureSchema } from "../db/migrate";
import { runImplementer } from "./implementer";
import { runReviewer } from "./reviewer";
import { reapOrphans, recoverCrashedRuns } from "./worktree";
import { listLabeledIssues } from "../github/client";
import { log } from "../shared/logger";
import { consumeDispatch } from "./dispatch";

const POLL_INTERVAL_MS = 60_000;
const REVIEWER_INTERVAL_MS = botConfig.reviewer.intervalMinutes * 60_000;
const DISPATCH_TICK_MS = 2_000;
const MAX_CONCURRENT_IMPLEMENTERS = 3;

// C11: cap how many issues the implementer can drive in parallel. Each issue
// spawns a Claude Code subprocess + tools; piling them on overwhelms the
// machine and burns API budget. Keys are repo/issue so per-issue dedup is
// cheap.
const inFlight = new Set<string>();
function inFlightKey(repo: string, issueNumber: number) {
  return `${repo}#${issueNumber}`;
}

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
      if (inFlight.size >= MAX_CONCURRENT_IMPLEMENTERS) {
        log.debug(
          "coord",
          `concurrency cap reached (${inFlight.size}) — deferring #${issue.number}`,
        );
        break;
      }
      const claimed = issue.labels.includes(botConfig.labels.claimed);
      if (claimed) continue;
      const repoFull = `${repoCfg.owner}/${repoCfg.name}`;
      const key = inFlightKey(repoFull, issue.number);
      if (inFlight.has(key)) continue;

      const existingRun = db
        .prepare(
          `SELECT id FROM runs WHERE repo=? AND issue_number=? AND status NOT IN ('failed','abandoned','succeeded','pr-opened','needs-review')`,
        )
        .get(repoFull, issue.number) as { id: number } | undefined;
      if (existingRun) continue;

      const repoDir = process.env.REPO_DIR;
      if (!repoDir) {
        log.warn(
          "coord",
          `REPO_DIR not set — cannot create worktree for ${repoFull}#${issue.number}`,
        );
        continue;
      }

      inFlight.add(key);
      // Fire and forget — drain via the .finally so the concurrency cap stays
      // honest even if the implementer throws.
      runImplementer({
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
      })
        .catch((err) =>
          log.error("coord", `implementer threw on ${key}: ${err}`),
        )
        .finally(() => inFlight.delete(key));
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

  // A3/B5: drain webhook-triggered dispatches on a tight tick.
  setInterval(() => {
    if (consumeDispatch("implementer")) {
      log.info("coord", "dispatch:implementer — webhook poke");
      pollOnce().catch((err) =>
        log.error("coord", `dispatch poll error: ${err}`),
      );
    }
    if (consumeDispatch("reviewer")) {
      log.info("coord", "dispatch:reviewer — webhook poke");
      reviewerOnce().catch((err) =>
        log.error("coord", `dispatch reviewer error: ${err}`),
      );
    }
  }, DISPATCH_TICK_MS);
}

if (typeof require !== "undefined" && require.main === module) {
  main().catch((err) => {
    log.error("coord", `fatal: ${err}`);
    process.exit(1);
  });
}

export { main };
