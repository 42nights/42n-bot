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
      // NOTE: we intentionally do NOT skip on the `bot-claimed` label. The
      // authoritative claim is now the active-run row below + the atomic
      // createRunRow insert in the implementer. Skipping on the label alone
      // meant a single failed `removeLabel` (GitHub 503/timeout on crash
      // recovery) left the label stuck forever and the issue permanently
      // un-pickable. Relying on the DB makes a stale claim self-healing.
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

      // Circuit breaker: stop re-picking an issue that keeps failing/abandoning.
      // A deliberate abort de-labels itself, but a repeated infra failure (e.g.
      // a transient git/clone error) keeps bot-please and would loop — and a $0
      // failure never trips the per-issue budget cap. Bound recent terminal
      // failures so a human has to remove + re-add bot-please to retry.
      const recentFails = db
        .prepare(
          `SELECT COUNT(*) AS c FROM runs
             WHERE repo=? AND issue_number=? AND status IN ('failed','abandoned')
               AND started_at > ?`,
        )
        .get(repoFull, issue.number, Date.now() - 2 * 60 * 60 * 1000) as {
        c: number;
      };
      if (recentFails.c >= 3) {
        log.warn(
          "coord",
          `${repoFull}#${issue.number}: ${recentFails.c} failed/abandoned runs in 2h — circuit breaker tripped, skipping (remove + re-add bot-please to retry)`,
        );
        continue;
      }

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

// QA5 (R5 finding 1, CRITICAL): reviewerOnce has THREE async entry points —
// the initial run, the interval tick, and the dispatch tick — all
// fire-and-forget. Without a guard, a dispatch tick can start a second
// reviewerOnce while the first is still awaiting the GitHub issue list, and
// both read the same open-issue set, both pass the dedup check on the same
// candidates, and both file the issue → duplicates. A single in-process flag
// serializes them (matches the cron scheduler's `ticking` guard + the
// MAX_CONCURRENT_REVIEWER_CRONS=1 intent).
let reviewerRunning = false;

async function reviewerOnce() {
  if (!botConfig.reviewer.enabled) return;
  if (reviewerRunning) {
    log.debug("coord", "reviewer already running — skipping re-entry");
    return;
  }
  reviewerRunning = true;
  try {
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
  } finally {
    reviewerRunning = false;
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

  // Fire the initial poll + reviewer pass WITHOUT awaiting. Awaiting them
  // here blocks every setInterval below from registering until they finish —
  // and the startup reviewer pass spawns a multi-minute Claude subprocess, so
  // the coordinator would be deaf to dispatch signals + polling for the whole
  // pass. Fire-and-forget so the intervals (especially the 2s dispatch drain)
  // come online immediately.
  pollOnce().catch((err) => log.error("coord", `startup poll error: ${err}`));
  reviewerOnce().catch((err) =>
    log.error("coord", `startup reviewer error: ${err}`),
  );

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
    // QA3 (R3 finding 7) + QA4: prune old cron history + webhook delivery
    // records so high-frequency activity can't grow the DB unbounded.
    try {
      const pruned = pruneCronRuns();
      if (pruned) log.info("coord", `pruned ${pruned} old cron_runs row(s)`);
      const cutoff = Date.now() - 30 * 24 * 60 * 60 * 1000;
      const wh = db
        .prepare(`DELETE FROM webhook_deliveries WHERE received_at < ?`)
        .run(cutoff);
      if (wh.changes)
        log.info("coord", `pruned ${wh.changes} old webhook_deliveries row(s)`);

      // Prune terminal runs older than the retention window. The schema's
      // ON DELETE CASCADE takes events, artifacts (can be multi-MB: diffs,
      // full critic reports) and verdicts with them, so a high-velocity repo
      // can't grow the DB without bound.
      const oldRuns = db
        .prepare(
          `DELETE FROM runs WHERE finished_at IS NOT NULL AND finished_at < ?`,
        )
        .run(cutoff);
      if (oldRuns.changes)
        log.info("coord", `pruned ${oldRuns.changes} old run(s) + cascaded rows`);

      // Prune stale dedup embeddings. lookupCache recomputes a missing/changed
      // embedding on demand (cheap, local model), so dropping cold entries is
      // safe and bounds the table.
      const emb = db
        .prepare(`DELETE FROM issue_embeddings WHERE cached_at < ?`)
        .run(cutoff);
      if (emb.changes)
        log.info("coord", `pruned ${emb.changes} stale issue_embedding(s)`);
    } catch (err) {
      log.warn("coord", `prune error: ${err}`);
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
