import path from "node:path";
import os from "node:os";
import fs from "node:fs/promises";
import simpleGit from "simple-git";
import { clearGitLocks } from "./coordinator/worktree";
import {
  ghInstallation,
  installationIdForRepo,
  appConfigured,
} from "./github/app";
import {
  getConnectedRepo,
  updateConnectedRepo,
  type ConnectedRepo,
} from "./repo-store";
import { log } from "./shared/logger";

const REPOS_ROOT =
  process.env.REPOS_ROOT ?? path.join(os.homedir(), ".42n-bot", "repos");

export function defaultCloneDir(owner: string, name: string): string {
  return path.join(REPOS_ROOT, owner, name);
}

async function dirExists(p: string): Promise<boolean> {
  try {
    const s = await fs.stat(p);
    return s.isDirectory();
  } catch {
    return false;
  }
}

async function isGitRepo(p: string): Promise<boolean> {
  return dirExists(path.join(p, ".git"));
}

async function tokenForInstallation(installationId: number): Promise<string> {
  // Octokit's auth-app strategy mints + caches installation tokens internally.
  // Pull the raw token so we can stuff it into a clone URL.
  const octo = ghInstallation(installationId);
  const auth = (await octo.auth({ type: "installation" })) as { token: string };
  return auth.token;
}

/**
 * GitHub login + repo-name character set. Validated before building any URL
 * so a row injection (or compromised webhook) can't redirect the clone to a
 * different host via "/" or "@" smuggling.
 */
const GH_NAME_RE = /^[A-Za-z0-9_.-]{1,100}$/;

export function isSafeGitHubName(s: string): boolean {
  return GH_NAME_RE.test(s);
}

function cloneUrlFor(args: {
  owner: string;
  name: string;
  token: string | null;
}): string {
  if (!isSafeGitHubName(args.owner) || !isSafeGitHubName(args.name)) {
    throw new Error(
      `Refused to construct clone URL: owner/name failed validation`,
    );
  }
  if (args.token) {
    return `https://x-access-token:${args.token}@github.com/${args.owner}/${args.name}.git`;
  }
  // PAT fallback — same trick with the env token.
  const pat = process.env.GITHUB_TOKEN;
  if (pat) {
    return `https://x-access-token:${pat}@github.com/${args.owner}/${args.name}.git`;
  }
  return `https://github.com/${args.owner}/${args.name}.git`;
}

/**
 * Ensure a connected repo has a local clone the coordinator can branch from.
 * Idempotent:
 *  - If `repo_dir` is set and contains a `.git`, fetch origin and return it.
 *  - Otherwise pick the default path (~/.42n-bot/repos/<owner>/<name>), clone
 *    using the installation token if available (else PAT), persist the path.
 */
export async function ensureLocalClone(repoId: number): Promise<{
  ok: true;
  repoDir: string;
  cloned: boolean;
  fetched: boolean;
} | { ok: false; error: string }> {
  const repo = getConnectedRepo(repoId);
  if (!repo) return { ok: false, error: "repo not found" };

  const targetDir =
    repo.repo_dir && repo.repo_dir.length > 0
      ? repo.repo_dir
      : defaultCloneDir(repo.owner, repo.name);

  // Already cloned: clean any stale lock files from a previous crash, then
  // fetch. Without the lock sweep, a leftover `.git/config.lock` blocks
  // every fetch forever and the repo gets stuck until a human deletes it.
  if (await isGitRepo(targetDir)) {
    try {
      await clearGitLocks(targetDir);
      const git = simpleGit(targetDir);
      await git.fetch("origin", repo.default_branch);
      if (!repo.repo_dir) {
        updateConnectedRepo(repo.id, { repo_dir: targetDir });
      }
      return { ok: true, repoDir: targetDir, cloned: false, fetched: true };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { ok: false, error: `fetch failed: ${msg}` };
    }
  }

  // Block accidental clone into a non-empty non-git dir — protects the user
  // from us writing into their unrelated checkout.
  if (await dirExists(targetDir)) {
    const entries = await fs.readdir(targetDir);
    if (entries.length > 0) {
      return {
        ok: false,
        error: `${targetDir} exists and is not empty (and not a git repo). Refusing to clone into it.`,
      };
    }
  }

  await fs.mkdir(path.dirname(targetDir), { recursive: true });

  let token: string | null = null;
  if (appConfigured()) {
    const installId = installationIdForRepo(repo.owner, repo.name);
    if (installId) {
      // QA3 (R3 finding 18): for an App-bound repo, one retry then a HARD
      // error. Silently falling back to the PAT here would clone with a
      // token that may lack permissions on this repo — a confusing partial
      // success. The PAT fallback below is only for repos with no
      // installation (PAT-connected repos), not for App-bound ones.
      try {
        token = await tokenForInstallation(installId);
      } catch (err1) {
        log.warn("clone", `installation token mint failed, retrying: ${err1}`);
        await new Promise((r) => setTimeout(r, 1000));
        try {
          token = await tokenForInstallation(installId);
        } catch (err2) {
          return {
            ok: false,
            error: `Could not mint an installation token for ${repo.owner}/${repo.name} (App-bound repo): ${err2 instanceof Error ? err2.message : String(err2)}`,
          };
        }
      }
    }
  }
  const url = cloneUrlFor({ owner: repo.owner, name: repo.name, token });

  try {
    const git = simpleGit();
    await git.clone(url, targetDir, ["--branch", repo.default_branch]);
    updateConnectedRepo(repo.id, { repo_dir: targetDir });
    log.info("clone", `cloned ${repo.owner}/${repo.name} → ${targetDir}`);
    return { ok: true, repoDir: targetDir, cloned: true, fetched: false };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    // Scrub the token out of any error message before surfacing it.
    const scrubbed = token ? msg.replaceAll(token, "<token>") : msg;
    return { ok: false, error: `clone failed: ${scrubbed}` };
  }
}

export type CloneResult = Awaited<ReturnType<typeof ensureLocalClone>>;

export async function ensureLocalCloneForRepo(
  repo: ConnectedRepo,
): Promise<CloneResult> {
  return ensureLocalClone(repo.id);
}
