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
 */
export function issueBudgetOk(
  repo: string,
  issueNumber: number,
): { ok: true } | { ok: false; spentUsd: number } {
  const row = db
    .prepare(
      `SELECT COALESCE(SUM(cost_usd), 0) AS spent FROM runs WHERE repo=? AND issue_number=?`,
    )
    .get(repo, issueNumber) as { spent: number };
  if (row.spent >= botConfig.budgets.perIssueUsd) {
    return { ok: false, spentUsd: row.spent };
  }
  return { ok: true };
}
