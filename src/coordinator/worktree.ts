import simpleGit from "simple-git";
import path from "node:path";
import fs from "node:fs/promises";
import { randomBytes } from "node:crypto";
import { botConfig } from "../../bot.config";
import { db } from "../db";
import { log } from "../shared/logger";

const PROTECTED_REFS = new Set(["main", "master", "trunk", "develop"]);

/** Belt-and-suspenders: anything that touches branches in the bot must call this first. */
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

  const git = simpleGit(args.repoDir);
  await git.fetch("origin", baseBranch);
  // git worktree add -b <new-branch> <path> <origin/<baseBranch>>
  await git.raw([
    "worktree",
    "add",
    "-b",
    branch,
    worktreePath,
    `origin/${baseBranch}`,
  ]);

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
    // Worktree dir missing / stale bookkeeping → prune.
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
  const stale = db
    .prepare(
      `SELECT worktree_path FROM runs
         WHERE worktree_path IS NOT NULL
           AND finished_at IS NOT NULL
           AND finished_at < ?`,
    )
    .all(sevenDaysAgo) as { worktree_path: string }[];
  for (const r of stale) {
    await removeWorktree({ repoDir, worktreePath: r.worktree_path, force: true });
  }
  if (stale.length) {
    db.prepare(
      `UPDATE runs SET worktree_path = NULL WHERE worktree_path IN (${stale.map(() => "?").join(",")})`,
    ).run(...stale.map((s) => s.worktree_path));
  }
}

export async function recoverCrashedRuns(repoDir: string) {
  const active = db
    .prepare(
      `SELECT id, worktree_path, repo, issue_number FROM runs
         WHERE status IN ('planning','implementing','verifying','iterating')`,
    )
    .all() as Array<{
    id: number;
    worktree_path: string | null;
    repo: string;
    issue_number: number | null;
  }>;
  for (const r of active) {
    if (r.worktree_path) {
      await removeWorktree({
        repoDir,
        worktreePath: r.worktree_path,
        force: true,
      });
    }
    db.prepare(
      `UPDATE runs SET status='failed', error_message='coordinator restart', finished_at=? WHERE id=?`,
    ).run(Date.now(), r.id);
  }
  return active.length;
}
