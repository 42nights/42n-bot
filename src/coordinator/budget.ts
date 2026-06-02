import { getDayCost, getIssueCostAndCount } from "../db/ops/runs";
import { botConfig } from "../../bot.config";

export async function dayBudgetOk(
  reservedUsd = 0,
): Promise<{ ok: true } | { ok: false; spentUsd: number }> {
  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);
  const spent = await getDayCost(startOfDay.getTime());
  if (spent + reservedUsd >= botConfig.budgets.perDayUsd) {
    return { ok: false, spentUsd: spent };
  }
  return { ok: true };
}

export async function issueBudgetOk(
  repo: string,
  issueNumber: number,
): Promise<{ ok: true } | { ok: false; spentUsd: number; priorRuns: number }> {
  const { spent, runs } = await getIssueCostAndCount(repo, issueNumber);
  if (spent >= botConfig.budgets.perIssueUsd) {
    return { ok: false, spentUsd: spent, priorRuns: runs };
  }
  return { ok: true };
}
