import simpleGit from "simple-git";
import path from "node:path";
import fs from "node:fs/promises";
import { randomBytes } from "node:crypto";
import { botConfig } from "../../bot.config";
import { log } from "../shared/logger";
import { ACTIVE_STATUSES } from "../shared/statuses";
import { ensureBaseDeps, linkNodeModulesIntoWorktree } from "../orchestrator/deps";
import { removeLabel } from "../github/client";
import {
  getStaleWorktrees,
  getActiveRunsForRepoDir,
  getReposForDir,
  patchRun,
  clearWorktreePaths,
} from "../db/ops/runs";

export async function clearGitLocks(repoDir: string): Promise<void> {
  const locks = [
    "config.lock",
    "index.lock",
    "HEAD.lock",
    "packed-refs.lock",
  ];
  await Promise.all(
    locks.map((name) =>
      fs.rm(path.join(repoDir, ".git", name), { force: true }).catch(() => {}),
    ),
  );
}

const repoGitChain = new Map<string, Promise<unknown>>();
async function withRepoGitLock<T>(
  repoDir: string,
  fn: () => Promise<T>,
): Promise<T> {
  const prev = repoGitChain.get(repoDir) ?? Promise.resolve();
  const run = prev.catch(() => {}).then(fn);
  repoGitChain.set(
    repoDir,
    run.catch(() => {}),
  );
  return run;
}

const PROTECTED_REFS = new Set(["main", "master", "trunk", "develop"]);

export function assertNotProtected(ref: string) {
  if (PROTECTED_REFS.has(ref)) {
    throw new Error(`Refusing to operate on protected ref: ${ref}`);
  }
}

export async function createWorktree(args: {
  repoDir: string;
  issueNumber: number;
  baseBranch?: string;
}): Promise<{ branch: string; worktreePath: string }> {
  const baseBranch = args.baseBranch ?? "main";
  const slug = randomBytes(3).toString("hex");
  const branch = `bot/issue-${args.issueNumber}-${slug}`;
  assertNotProtected(branch);
  const worktreePath = path.join(
    botConfig.workspaceRoot,
    `issue-${args.issueNumber}-${slug}`,
  );

  await fs.mkdir(botConfig.workspaceRoot, { recursive: true });
  await ensureBaseDeps(args.repoDir);

  await withRepoGitLock(args.repoDir, async () => {
    const git = simpleGit(args.repoDir);
    await clearGitLocks(args.repoDir);
    await git.fetch("origin", baseBranch);
    await git.raw([
      "worktree",
      "add",
      "-b",
      branch,
      worktreePath,
      `origin/${baseBranch}`,
    ]);
  });

  await linkNodeModulesIntoWorktree(args.repoDir, worktreePath);

  return { branch, worktreePath };
}

export async function removeWorktree(args: {
  repoDir: string;
  worktreePath: string;
  force?: boolean;
}) {
  const git = simpleGit(args.repoDir);
  const removeArgs = ["worktree", "remove"];
  if (args.force) removeArgs.push("--force");
  removeArgs.push(args.worktreePath);
  try {
    await git.raw(removeArgs);
  } catch {
    await git.raw(["worktree", "prune"]);
  }
}

export async function reapOrphans(repoDir: string) {
  const git = simpleGit(repoDir);
  const dryRun = await git.raw(["worktree", "prune", "--dry-run", "-v"]);
  if (dryRun.trim()) {
    log.info("worktree", `pruning:\n${dryRun}`);
    await git.raw(["worktree", "prune"]);
  }
  const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
  const stale = await getStaleWorktrees(sevenDaysAgo);
  for (const r of stale) {
    if (r.worktree_path) {
      await removeWorktree({
        repoDir,
        worktreePath: r.worktree_path,
        force: true,
      });
    }
  }
  if (stale.length) {
    await clearWorktreePaths(stale.map((s) => s._id));
  }
}

export async function recoverCrashedRuns(repoDir: string) {
  await clearGitLocks(repoDir);

  const reposForDir = await getReposForDir(repoDir);
  const repoKeys = new Set(
    reposForDir.map((r) => `${r.owner}/${r.name}`),
  );

  const active = await getActiveRunsForRepoDir(Array.from(repoKeys));

  let cleaned = 0;
  for (const r of active) {
    if (repoKeys.size > 0 && !repoKeys.has(r.repo)) continue;
    if (r.worktree_path) {
      await removeWorktree({
        repoDir,
        worktreePath: r.worktree_path,
        force: true,
      });
    }
    if (r.branch_name) {
      assertNotProtected(r.branch_name);
      try {
        await simpleGit(repoDir).raw(["branch", "-D", r.branch_name]);
      } catch {
        // Branch may not exist.
      }
    }
    await patchRun(r._id, {
      status: "failed",
      error_message: "coordinator restart",
      finished_at: Date.now(),
    });

    if (r.issue_number != null) {
      const [owner, name] = r.repo.split("/");
      if (owner && name) {
        await removeLabel({
          owner,
          repo: name,
          issue_number: r.issue_number,
          label: botConfig.labels.claimed,
        }).catch((err) =>
          log.warn(
            "worktree",
            `could not release bot-claimed on ${r.repo}#${r.issue_number}: ${err}`,
          ),
        );
      }
    }
    cleaned++;
  }
  return cleaned;
}
