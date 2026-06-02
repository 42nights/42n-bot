import { convex, api } from "../convex-client";
import type { Id } from "../../../convex/_generated/dataModel";

export type RunRow = {
  _id: string;
  type: string;
  repo: string;
  issue_number?: number;
  issue_title?: string;
  issue_body?: string;
  branch_name?: string;
  pr_number?: number;
  pr_url?: string;
  status: string;
  worktree_path?: string;
  attempts: number;
  cost_usd: number;
  started_at: number;
  finished_at?: number;
  error_message?: string;
  issue_type?: string;
  understanding_json?: string;
  acceptance_test_paths_json?: string;
  runtime_verification_json?: string;
  replan_count?: number;
  is_system?: boolean;
};

export async function listRuns(args?: {
  status?: string;
  type?: string;
  repo?: string;
  limit?: number;
}): Promise<RunRow[]> {
  const rows = await convex.query(api.runs.list, {
    status: args?.status,
    type: args?.type,
    repo: args?.repo,
    limit: args?.limit,
  });
  return rows as RunRow[];
}

export async function getRun(id: string): Promise<RunRow | null> {
  const row = await convex.query(api.runs.getById, { id: id as Id<"runs"> });
  return (row as RunRow | null) ?? null;
}

export async function rollup24h(repo?: string) {
  return convex.query(api.runs.rollup24h, { repo });
}

export async function getActiveRunForIssue(
  repo: string,
  issue_number: number,
): Promise<RunRow | null> {
  const row = await convex.query(api.runs.getActiveForIssue, {
    repo,
    issue_number,
  });
  return (row as RunRow | null) ?? null;
}

export async function getRecentFailsForIssue(
  repo: string,
  issue_number: number,
  since: number,
): Promise<number> {
  return convex.query(api.runs.getRecentFailsForIssue, {
    repo,
    issue_number,
    since,
  });
}

export async function getDayCost(since: number): Promise<number> {
  return convex.query(api.runs.getDayCost, { since });
}

export async function getIssueCostAndCount(
  repo: string,
  issue_number: number,
): Promise<{ spent: number; runs: number }> {
  return convex.query(api.runs.getIssueCostAndCount, { repo, issue_number });
}

export async function getRunByPrNumber(
  pr_number: number,
): Promise<RunRow | null> {
  const row = await convex.query(api.runs.getByPrNumber, { pr_number });
  return (row as RunRow | null) ?? null;
}

export async function getActiveRuns(): Promise<RunRow[]> {
  const rows = await convex.query(api.runs.getActiveRuns, {});
  return rows as RunRow[];
}

export async function getStaleWorktrees(cutoff: number): Promise<RunRow[]> {
  const rows = await convex.query(api.runs.getStaleWorktrees, { cutoff });
  return rows as RunRow[];
}

export async function getActiveRunsForRepoDir(
  repoKeys: string[],
): Promise<RunRow[]> {
  const rows = await convex.query(api.runs.getActiveRunsForRepoDir, {
    repoKeys,
  });
  return rows as RunRow[];
}

export async function getReposForDir(
  repo_dir: string,
): Promise<Array<{ owner: string; name: string }>> {
  const rows = await convex.query(api.runs.getReposForDir, { repo_dir });
  return rows as Array<{ owner: string; name: string }>;
}

export async function createRun(args: {
  type: string;
  repo: string;
  issue_number?: number;
  issue_title?: string;
  issue_body?: string;
  status: string;
  started_at: number;
  is_system?: boolean;
}): Promise<string> {
  return convex.mutation(api.runs.create, args) as Promise<string>;
}

export async function createRunIfNoActive(args: {
  type: string;
  repo: string;
  issue_number: number;
  issue_title?: string;
  issue_body?: string;
  status: string;
  started_at: number;
}): Promise<string | null> {
  return convex.mutation(api.runs.createIfNoActive, args) as Promise<
    string | null
  >;
}

export async function patchRun(
  id: string,
  patch: Record<string, unknown>,
): Promise<void> {
  await convex.mutation(api.runs.patch, {
    id: id as Id<"runs">,
    patchJson: JSON.stringify(patch),
  });
}

export async function incrementRunCost(
  id: string,
  delta: number,
): Promise<void> {
  await convex.mutation(api.runs.incrementCost, {
    id: id as Id<"runs">,
    delta,
  });
}

export async function getRunCost(id: string): Promise<number> {
  return convex.query(api.runs.getRunCost, { id: id as Id<"runs"> });
}

export async function getRunsByRepoAndIssues(
  repo: string,
  issue_numbers: number[],
): Promise<RunRow[]> {
  const rows = await convex.query(api.runs.getRunsByRepoAndIssues, {
    repo,
    issue_numbers,
  });
  return rows as RunRow[];
}

export async function clearWorktreePaths(ids: string[]): Promise<void> {
  await convex.mutation(api.runs.clearWorktreePaths, {
    ids: ids as Id<"runs">[],
  });
}

export async function getSystemRun(): Promise<RunRow | null> {
  const row = await convex.query(api.runs.getSystemRun, {});
  return (row as RunRow | null) ?? null;
}

export async function ensureSystemRun(started_at: number): Promise<string> {
  return convex.mutation(api.runs.ensureSystemRun, {
    started_at,
  }) as Promise<string>;
}

export async function pruneOldRuns(cutoff: number): Promise<number> {
  return convex.mutation(api.runs.pruneOldRuns, { cutoff });
}
