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
  const octo = await ghInstallation(installationId);
  const auth = (await octo.auth({ type: "installation" })) as { token: string };
  return auth.token;
}

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
      "Refused to construct clone URL: owner/name failed validation",
    );
  }
  if (args.token) {
    return `https://x-access-token:${args.token}@github.com/${args.owner}/${args.name}.git`;
  }
  const pat = process.env.GITHUB_TOKEN;
  if (pat) {
    return `https://x-access-token:${pat}@github.com/${args.owner}/${args.name}.git`;
  }
  return `https://github.com/${args.owner}/${args.name}.git`;
}

export async function ensureLocalClone(repoId: string): Promise<
  | { ok: true; repoDir: string; cloned: boolean; fetched: boolean }
  | { ok: false; error: string }
> {
  const repo = await getConnectedRepo(repoId);
  if (!repo) return { ok: false, error: "repo not found" };

  const targetDir =
    repo.repo_dir && repo.repo_dir.length > 0
      ? repo.repo_dir
      : defaultCloneDir(repo.owner, repo.name);

  if (await isGitRepo(targetDir)) {
    try {
      await clearGitLocks(targetDir);
      const git = simpleGit(targetDir);
      await git.fetch("origin", repo.default_branch);
      if (!repo.repo_dir) {
        await updateConnectedRepo(repo._id, { repo_dir: targetDir });
      }
      return { ok: true, repoDir: targetDir, cloned: false, fetched: true };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { ok: false, error: `fetch failed: ${msg}` };
    }
  }

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
  if (await appConfigured()) {
    const installId = await installationIdForRepo(repo.owner, repo.name);
    if (installId) {
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
            error: `Could not mint an installation token for ${repo.owner}/${repo.name}: ${err2 instanceof Error ? err2.message : String(err2)}`,
          };
        }
      }
    }
  }
  const url = cloneUrlFor({ owner: repo.owner, name: repo.name, token });

  try {
    const git = simpleGit();
    await git.clone(url, targetDir, ["--branch", repo.default_branch]);
    await updateConnectedRepo(repo._id, { repo_dir: targetDir });
    log.info("clone", `cloned ${repo.owner}/${repo.name} → ${targetDir}`);
    return { ok: true, repoDir: targetDir, cloned: true, fetched: false };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const scrubbed = token ? msg.replaceAll(token, "<token>") : msg;
    return { ok: false, error: `clone failed: ${scrubbed}` };
  }
}

export async function freshPushAuth(
  owner: string,
  name: string,
): Promise<{ url: string; token: string | null }> {
  let token: string | null = null;
  if (await appConfigured()) {
    const installId = await installationIdForRepo(owner, name);
    if (installId) {
      try {
        token = await tokenForInstallation(installId);
      } catch (err1) {
        log.warn("push-auth", `installation token mint failed, retrying: ${err1}`);
        await new Promise((r) => setTimeout(r, 1000));
        try {
          token = await tokenForInstallation(installId);
        } catch (err2) {
          log.warn(
            "push-auth",
            `installation token mint failed twice, falling back to PAT: ${err2 instanceof Error ? err2.message : String(err2)}`,
          );
        }
      }
    }
  }
  if (!token) token = process.env.GITHUB_TOKEN ?? null;
  const url = cloneUrlFor({ owner, name, token });
  return { url, token };
}

export type CloneResult = Awaited<ReturnType<typeof ensureLocalClone>>;

export async function ensureLocalCloneForRepo(
  repo: ConnectedRepo,
): Promise<CloneResult> {
  return ensureLocalClone(repo._id);
}
