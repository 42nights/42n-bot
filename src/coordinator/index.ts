/* eslint-disable no-console */
import { botConfig } from "../../bot.config";
import { ensureSchema } from "../db/migrate";
import { runImplementer } from "./implementer";
import { runReviewer } from "./reviewer";
import { reapOrphans, recoverCrashedRuns } from "./worktree";
import { listLabeledIssues } from "../github/client";
import { log } from "../shared/logger";
import { consumeDispatch } from "./dispatch";
import { activeRepos } from "../repo-store";
import { tickScheduler } from "../cron/scheduler";
import { pruneCronRunRows } from "../db/ops/crons";
import { dayBudgetOk, issueBudgetOk } from "./budget";
import { ACTIVE_STATUSES } from "../shared/statuses";
import { requireTenantEnv, tenant } from "../../lib/tenant";
import { startHeartbeat } from "../castle/events";
import {
  getActiveRunForIssue,
  getRecentFailsForIssue,
  pruneOldRuns,
} from "../db/ops/runs";
import {
  pruneOldWebhookDeliveries,
} from "../db/ops/webhookDeliveries";
import { pruneStaleIssueEmbeddings } from "../db/ops/issueEmbeddings";

const POLL_INTERVAL_MS = 60_000;
const REVIEWER_INTERVAL_MS = botConfig.reviewer.intervalMinutes * 60_000;
const DISPATCH_TICK_MS = 2_000;
const CRON_TICK_MS = 30_000;
const MAX_CONCURRENT_IMPLEMENTERS = 3;

const inFlight = new Set<string>();
function inFlightKey(repo: string, issueNumber: number) {
  return `${repo}#${issueNumber}`;
}

let reservedSpendUsd = 0;

async function pollOnce() {
  for (const repoCfg of await activeRepos()) {
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
          `concurrency cap reached (${inFlight.size}) — deferring further pickups this tick`,
        );
        return;
      }
      const repoFull = `${repoCfg.owner}/${repoCfg.name}`;
      const key = inFlightKey(repoFull, issue.number);
      if (inFlight.has(key)) continue;

      const existingRun = await getActiveRunForIssue(repoFull, issue.number);
      if (existingRun) continue;

      const recentFails = await getRecentFailsForIssue(
        repoFull,
        issue.number,
        Date.now() - 2 * 60 * 60 * 1000,
      );
      if (recentFails >= 3) {
        log.warn(
          "coord",
          `${repoFull}#${issue.number}: ${recentFails} failed/abandoned runs in 2h — circuit breaker tripped`,
        );
        continue;
      }

      const repoDir = repoCfg.repo_dir ?? process.env.REPO_DIR;
      if (!repoDir) {
        log.warn(
          "coord",
          `${repoFull}: no local clone path set — skipping #${issue.number}`,
        );
        continue;
      }

      const day = await dayBudgetOk(reservedSpendUsd);
      if (!day.ok) {
        log.warn(
          "coord",
          `daily budget exceeded ($${day.spentUsd.toFixed(2)} + $${reservedSpendUsd.toFixed(2)} reserved) — deferring`,
        );
        return;
      }
      const issueBudget = await issueBudgetOk(repoFull, issue.number);
      if (!issueBudget.ok) {
        log.warn(
          "coord",
          `per-issue budget exceeded for ${repoFull}#${issue.number}: ` +
            `$${issueBudget.spentUsd.toFixed(2)} across ${issueBudget.priorRuns} run(s)`,
        );
        continue;
      }

      inFlight.add(key);
      reservedSpendUsd += botConfig.budgets.perRunUsd;
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

let reviewerRunning = false;

async function reviewerOnce() {
  if (!botConfig.reviewer.enabled) return;
  if (reviewerRunning) {
    log.debug("coord", "reviewer already running — skipping re-entry");
    return;
  }
  reviewerRunning = true;
  try {
    for (const repoCfg of await activeRepos()) {
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

async function uniqueRepoDirs(): Promise<string[]> {
  const dirs = new Set<string>();
  for (const r of await activeRepos()) {
    const d = r.repo_dir ?? process.env.REPO_DIR;
    if (d) dirs.add(d);
  }
  return Array.from(dirs);
}

async function main() {
  requireTenantEnv();
  if (tenant.slug) {
    log.info("coord", `[boot] Otis coordinator starting for tenant=${tenant.slug}`);
    startHeartbeat();
  }
  ensureSchema();

  for (const dir of await uniqueRepoDirs()) {
    const recovered = await recoverCrashedRuns(dir).catch(() => 0);
    if (recovered) log.info("coord", `recovered ${recovered} crashed run(s) in ${dir}`);
    await reapOrphans(dir).catch((err) =>
      log.warn("coord", `reapOrphans(${dir}) failed: ${err}`),
    );
  }

  log.info("coord", "42n-bot coordinator started");

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

  setInterval(async () => {
    for (const dir of await uniqueRepoDirs()) {
      reapOrphans(dir).catch((err) =>
        log.error("coord", `reap error (${dir}): ${err}`),
      );
    }
    try {
      const cutoff = Date.now() - 30 * 24 * 60 * 60 * 1000;

      const pruned = await pruneCronRunRows(cutoff);
      if (pruned) log.info("coord", `pruned ${pruned} old cron_runs row(s)`);

      const wh = await pruneOldWebhookDeliveries(cutoff);
      if (wh) log.info("coord", `pruned ${wh} old webhook_deliveries row(s)`);

      const oldRuns = await pruneOldRuns(cutoff);
      if (oldRuns) log.info("coord", `pruned ${oldRuns} old run(s)`);

      const emb = await pruneStaleIssueEmbeddings(cutoff);
      if (emb) log.info("coord", `pruned ${emb} stale issue_embedding(s)`);
    } catch (err) {
      log.warn("coord", `prune error: ${err}`);
    }
  }, 6 * 60 * 60_000);

  // Dispatch tick — now async.
  setInterval(async () => {
    try {
      if (await consumeDispatch("implementer")) {
        log.info("coord", "dispatch:implementer — webhook poke");
        pollOnce().catch((err) =>
          log.error("coord", `dispatch poll error: ${err}`),
        );
      }
      if (await consumeDispatch("reviewer")) {
        log.info("coord", "dispatch:reviewer — webhook poke");
        reviewerOnce().catch((err) =>
          log.error("coord", `dispatch reviewer error: ${err}`),
        );
      }
    } catch (err) {
      log.warn("coord", `dispatch tick error: ${err}`);
    }
  }, DISPATCH_TICK_MS);

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
