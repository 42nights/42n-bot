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
import { activeRepos } from "../repo-store";
import { tickScheduler } from "../cron/scheduler";
import { pruneCronRuns } from "../cron/store";
import { dayBudgetOk, issueBudgetOk } from "./budget";
import { ACTIVE_STATUSES } from "../shared/statuses";

const POLL_INTERVAL_MS = 60_000;
const REVIEWER_INTERVAL_MS = botConfig.reviewer.intervalMinutes * 60_000;
const DISPATCH_TICK_MS = 2_000;
const CRON_TICK_MS = 30_000;
const MAX_CONCURRENT_IMPLEMENTERS = 3;

// C11: cap how many issues the implementer can drive in parallel. Each issue
// spawns a Claude Code subprocess + tools; piling them on overwhelms the
// machine and burns API budget. Keys are repo/issue so per-issue dedup is
// cheap.
const inFlight = new Set<string>();
function inFlightKey(repo: string, issueNumber: number) {
  return `${repo}#${issueNumber}`;
}

// QA3: in-memory budget reservation. Each launched run reserves its per-run
// cap; the reservation is released in the run's `.finally`. dayBudgetOk reads
// this so concurrent launches in a single poll tick — whose costs aren't
// written to the DB until the runs progress — can't all bypass the day cap.
let reservedSpendUsd = 0;

async function pollOnce() {
  for (const repoCfg of activeRepos()) {
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
      // QA1: the cap previously used `break`, which exited only the inner
      // (per-issue) loop and let the next repo blow past it. Three repos
      // with 1 issue each could spawn 3 × MAX = 9 implementers. Using
      // `return` ends the entire poll cycle — next tick (60s) re-checks.
      if (inFlight.size >= MAX_CONCURRENT_IMPLEMENTERS) {
        log.debug(
          "coord",
          `concurrency cap reached (${inFlight.size}) — deferring further pickups this tick`,
        );
        return;
      }
      const claimed = issue.labels.includes(botConfig.labels.claimed);
      if (claimed) continue;
      const repoFull = `${repoCfg.owner}/${repoCfg.name}`;
      const key = inFlightKey(repoFull, issue.number);
      if (inFlight.has(key)) continue;

      const placeholders = ACTIVE_STATUSES.map(() => "?").join(",");
      const existingRun = db
        .prepare(
          `SELECT id FROM runs WHERE repo=? AND issue_number=? AND status IN (${placeholders})`,
        )
        .get(repoFull, issue.number, ...ACTIVE_STATUSES) as
        | { id: number }
        | undefined;
      if (existingRun) continue;

      const repoDir = repoCfg.repo_dir ?? process.env.REPO_DIR;
      if (!repoDir) {
        log.warn(
          "coord",
          `${repoFull}: no local clone path set (add one on /repos, or set REPO_DIR) — skipping #${issue.number}`,
        );
        continue;
      }

      // QA3 (R3 findings 15/16): gate on budget HERE, before we add to
      // inFlight + fire-and-forget. Two wins:
      //  - An over-budget issue never occupies an inFlight slot, so it can't
      //    DoS-loop the poller (it just gets skipped with `continue`).
      //  - `reservedSpendUsd` reserves the per-run cap for each launched run
      //    so multiple launches in one tick don't all read the same pre-run
      //    DB total and collectively bust the day cap (the cost is only
      //    written to the DB during the run).
      const day = dayBudgetOk(reservedSpendUsd);
      if (!day.ok) {
        log.warn(
          "coord",
          `daily budget exceeded ($${day.spentUsd.toFixed(2)} + $${reservedSpendUsd.toFixed(2)} reserved) — deferring pickups this tick`,
        );
        return;
      }
      const issueBudget = issueBudgetOk(repoFull, issue.number);
      if (!issueBudget.ok) {
        log.warn(
          "coord",
          `per-issue budget exceeded for ${repoFull}#${issue.number}: ` +
            `$${issueBudget.spentUsd.toFixed(2)} across ${issueBudget.priorRuns} run(s) — skipping`,
        );
        continue;
      }

      inFlight.add(key);
      reservedSpendUsd += botConfig.budgets.perRunUsd;
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
        .finally(() => {
          inFlight.delete(key);
          reservedSpendUsd = Math.max(
            0,
            reservedSpendUsd - botConfig.budgets.perRunUsd,
          );
        });
    }
  }
}

async function reviewerOnce() {
  if (!botConfig.reviewer.enabled) return;
  for (const repoCfg of activeRepos()) {
    if (!repoCfg.enabled) continue;
    const repoDir = repoCfg.repo_dir ?? process.env.REPO_DIR;
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

function uniqueRepoDirs(): string[] {
  const dirs = new Set<string>();
  for (const r of activeRepos()) {
    const d = r.repo_dir ?? process.env.REPO_DIR;
    if (d) dirs.add(d);
  }
  return Array.from(dirs);
}

async function main() {
  ensureSchema();
  for (const dir of uniqueRepoDirs()) {
    const recovered = await recoverCrashedRuns(dir).catch(() => 0);
    if (recovered) log.info("coord", `recovered ${recovered} crashed run(s) in ${dir}`);
    await reapOrphans(dir).catch((err) =>
      log.warn("coord", `reapOrphans(${dir}) failed: ${err}`),
    );
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
    for (const dir of uniqueRepoDirs()) {
      reapOrphans(dir).catch((err) =>
        log.error("coord", `reap error (${dir}): ${err}`),
      );
    }
    // QA3 (R3 finding 7): prune old cron history so a high-frequency cron
    // can't grow the DB unbounded.
    try {
      const pruned = pruneCronRuns();
      if (pruned) log.info("coord", `pruned ${pruned} old cron_runs row(s)`);
    } catch (err) {
      log.warn("coord", `cron prune error: ${err}`);
    }
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

  // v0.3 crons: fire user-scheduled actions on a 30s heartbeat.
  setInterval(() => {
    tickScheduler().catch((err) =>
      log.error("coord", `cron tick error: ${err}`),
    );
  }, CRON_TICK_MS);
}

if (typeof require !== "undefined" && require.main === module) {
  main().catch((err) => {
    log.error("coord", `fatal: ${err}`);
    process.exit(1);
  });
}

export { main };
