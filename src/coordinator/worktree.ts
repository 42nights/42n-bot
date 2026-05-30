import simpleGit from "simple-git";
import path from "node:path";
import fs from "node:fs/promises";
import { randomBytes } from "node:crypto";
import { botConfig } from "../../bot.config";
import { db } from "../db";
import { log } from "../shared/logger";
import { ACTIVE_STATUSES } from "../shared/statuses";
import { ensureBaseDeps, linkNodeModulesIntoWorktree } from "../orchestrator/deps";
import { removeLabel } from "../github/client";

/**
 * Crashed git operations (worktree add, push, fetch) sometimes leave lock
 * files in `.git/`. They block every subsequent op until removed. Cheap to
 * sweep on startup + before fetches.
 */
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

  // Install deps in the base clone (idempotent) BEFORE creating the worktree,
  // so the worktree we hand the implementer can actually run tests. Without
  // this the verification harness has no node_modules and the implementer
  // thrashes against `<runner>: not found`.
  await ensureBaseDeps(args.repoDir);

  // git worktree add -b <new-branch> <path> <origin/<baseBranch>>
  await git.raw([
    "worktree",
    "add",
    "-b",
    branch,
    worktreePath,
    `origin/${baseBranch}`,
  ]);

  // Share the base clone's node_modules into the fresh worktree (symlink).
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

/**
 * Sweep crashed runs back to 'failed' and clean up their on-disk debris.
 *
 * Per-repo: the caller passes the `repoDir` they own, and we only touch runs
 * whose `repo` column matches a row in `repos` with that `repo_dir`. Bot
 * instances watching multiple repos call this once per dir so each one's
 * worktrees + branches get scrubbed in the right git context.
 *
 * What we clean per crashed run:
 *  - The worktree dir (via `git worktree remove --force`)
 *  - The dangling `bot/issue-*` branch left behind
 *  - Stale `.git/*.lock` files in the parent repoDir
 */
export async function recoverCrashedRuns(repoDir: string) {
  await clearGitLocks(repoDir);

  // Match runs to this repoDir via the `repos` table. Falls back to "all
  // active runs" if there are no rows with a repo_dir (PAT-only setup with
  // process.env.REPO_DIR — only one repoDir exists, ambiguity moot).
  const reposForDir = db
    .prepare(`SELECT owner, name FROM repos WHERE repo_dir = ?`)
    .all(repoDir) as Array<{ owner: string; name: string }>;
  const repoKeys = new Set(reposForDir.map((r) => `${r.owner}/${r.name}`));

  // QA3 (R3 finding 20): use the shared ACTIVE_STATUSES so this can't drift
  // from the coordinator's list and orphan crashed runs in a new status.
  const ph = ACTIVE_STATUSES.map(() => "?").join(",");
  const active = db
    .prepare(
      `SELECT id, worktree_path, repo, issue_number, branch_name FROM runs
         WHERE status IN (${ph})`,
    )
    .all(...ACTIVE_STATUSES) as Array<{
    id: number;
    worktree_path: string | null;
    repo: string;
    issue_number: number | null;
    branch_name: string | null;
  }>;

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
        // Branch may not exist (never got created, or already cleaned). Fine.
      }
    }
    db.prepare(
      `UPDATE runs SET status='failed', error_message='coordinator restart', finished_at=? WHERE id=?`,
    ).run(Date.now(), r.id);

    // Release the claim. The implementer applies `bot-claimed` as a
    // cross-process lock the moment it picks an issue up; if it's killed
    // mid-run (deploy, crash, restart), that label sticks and permanently
    // blocks re-pickup — the issue looks "claimed" forever with no live run.
    // Drop it (keep `bot-please`) so the next poll retries the issue.
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
