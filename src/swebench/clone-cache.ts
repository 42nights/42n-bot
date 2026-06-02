import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { CLONE_CACHE_DIR, WORKTREE_BASE_DIR } from "./config";

function cloneDir(repo: string): string {
  return path.resolve(CLONE_CACHE_DIR, repo.replace("/", "__"));
}

function worktreeDir(runId: string): string {
  return path.resolve(WORKTREE_BASE_DIR, `run-${runId}`);
}

/**
 * Ensure a full (non-bare) clone of `owner/name` exists in the local cache.
 * Safe to call concurrently for different repos; for the same repo it's a
 * no-op after the first call. Does a `git fetch --prune` to keep the cache
 * fresh on subsequent calls.
 */
export async function ensureRepoClone(repo: string): Promise<string> {
  const dir = cloneDir(repo);

  if (!fs.existsSync(path.join(dir, ".git"))) {
    const cacheParent = path.dirname(dir);
    if (!fs.existsSync(cacheParent)) {
      fs.mkdirSync(cacheParent, { recursive: true });
    }
    process.stderr.write(`Cloning https://github.com/${repo}.git into ${dir}\n`);
    execSync(`git clone --quiet https://github.com/${repo}.git ${dir}`, {
      stdio: ["ignore", "ignore", "pipe"],
    });
  } else {
    // Fetch to pick up commits referenced by newer instances.
    try {
      execSync(`git fetch --quiet --prune origin`, {
        cwd: dir,
        stdio: ["ignore", "ignore", "pipe"],
      });
    } catch {
      // Non-fatal: offline or rate-limited. The base_commit may already be
      // present from the initial clone.
    }
  }

  return dir;
}

/**
 * Create a git worktree at a unique path, detached at `base_commit`.
 * Idempotent: if the worktree dir already exists it is removed first (handles
 * a crashed previous attempt).
 *
 * Returns the absolute path to the worktree directory.
 */
export async function checkoutInstance(
  repo: string,
  baseCommit: string,
  runId: string,
): Promise<string> {
  const repoDir = await ensureRepoClone(repo);
  const wtPath = worktreeDir(runId);

  if (fs.existsSync(wtPath)) {
    // Stale worktree from a previous crashed run — prune and remove.
    try {
      execSync(`git worktree remove --force ${wtPath}`, {
        cwd: repoDir,
        stdio: ["ignore", "ignore", "pipe"],
      });
    } catch {
      fs.rmSync(wtPath, { recursive: true, force: true });
    }
    try {
      execSync(`git worktree prune`, {
        cwd: repoDir,
        stdio: ["ignore", "ignore", "pipe"],
      });
    } catch {
      // Best-effort.
    }
  }

  const wtParent = path.dirname(wtPath);
  if (!fs.existsSync(wtParent)) {
    fs.mkdirSync(wtParent, { recursive: true });
  }

  // Ensure the commit is available (might not be if clone was shallow).
  try {
    execSync(`git fetch --quiet origin ${baseCommit}`, {
      cwd: repoDir,
      stdio: ["ignore", "ignore", "pipe"],
    });
  } catch {
    // The commit may already be in the clone from the initial clone.
  }

  // Detached checkout at the exact base_commit SHA.
  execSync(`git worktree add --detach ${wtPath} ${baseCommit}`, {
    cwd: repoDir,
    stdio: ["ignore", "ignore", "pipe"],
  });

  process.stderr.write(
    `Checked out ${repo}@${baseCommit.slice(0, 12)} -> ${wtPath}\n`,
  );

  return wtPath;
}

/**
 * Remove a git worktree. Idempotent — safe to call even if the worktree was
 * already removed or never created.
 */
export async function cleanupCheckout(
  repo: string,
  runId: string,
): Promise<void> {
  const repoDir = cloneDir(repo);
  const wtPath = worktreeDir(runId);

  if (!fs.existsSync(wtPath)) return;

  try {
    execSync(`git worktree remove --force ${wtPath}`, {
      cwd: repoDir,
      stdio: ["ignore", "ignore", "pipe"],
    });
  } catch {
    // Fallback: rmSync if git worktree remove fails (e.g. repoDir gone).
    try {
      fs.rmSync(wtPath, { recursive: true, force: true });
    } catch {
      // Best-effort.
    }
  }

  try {
    execSync(`git worktree prune`, {
      cwd: repoDir,
      stdio: ["ignore", "ignore", "pipe"],
    });
  } catch {
    // Best-effort.
  }
}
