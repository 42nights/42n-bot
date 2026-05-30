import { db } from "../db";
import { botConfig } from "../../bot.config";

/**
 * Per-day budget: refuse new implementer runs once daily spend exceeds the cap.
 */
export function dayBudgetOk(): { ok: true } | { ok: false; spentUsd: number } {
  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);
  const row = db
    .prepare(`SELECT COALESCE(SUM(cost_usd), 0) AS spent FROM runs WHERE started_at >= ?`)
    .get(startOfDay.getTime()) as { spent: number };
  if (row.spent >= botConfig.budgets.perDayUsd) {
    return { ok: false, spentUsd: row.spent };
  }
  return { ok: true };
}

/**
 * Per-issue budget: total cost across attempts for one issue.
 *
 * QA2: also surfaces how many prior runs the issue accumulated, so when a
 * crash-looping issue silently hits its cap the log explains WHY (e.g.
 * "3 prior runs totalling $10.40") rather than just refusing opaquely.
 */
export function issueBudgetOk(
  repo: string,
  issueNumber: number,
): { ok: true } | { ok: false; spentUsd: number; priorRuns: number } {
  const row = db
    .prepare(
      `SELECT COALESCE(SUM(cost_usd), 0) AS spent, COUNT(*) AS runs
         FROM runs WHERE repo=? AND issue_number=?`,
    )
    .get(repo, issueNumber) as { spent: number; runs: number };
  if (row.spent >= botConfig.budgets.perIssueUsd) {
    return { ok: false, spentUsd: row.spent, priorRuns: row.runs };
  }
  return { ok: true };
}
