import { db } from "./db";
import { ghFor } from "./github/client";
import { botConfig, type BotRepo } from "../bot.config";

export type ConnectedRepo = {
  id: number;
  owner: string;
  name: string;
  default_branch: string;
  enabled: number;
  repo_dir: string | null;
  repo_url: string | null;
  description: string | null;
  created_at: number;
  updated_at: number;
};

/**
 * Single source of truth for the repos the bot watches.
 *
 * Storage: SQLite `repos` table. Falls back to bot.config.repos when the DB is
 * empty so a fresh install still works without UI setup.
 *
 * The DB shape mirrors BotRepo + extra fields the UI surfaces:
 *  - repo_dir: absolute path to the local clone (where worktrees branch from)
 *  - repo_url: html_url from GitHub (for display)
 *  - description: from GitHub
 */
export function listConnectedRepos(): ConnectedRepo[] {
  const rows = db
    .prepare(
      `SELECT * FROM repos ORDER BY enabled DESC, updated_at DESC`,
    )
    .all() as ConnectedRepo[];
  return rows;
}

/**
 * Repos the coordinator should actually drive. Reads the DB first; falls back
 * to bot.config when nothing is connected yet so existing flows still work.
 */
export function activeRepos(): Array<
  BotRepo & { repo_dir: string | null; id: number | null }
> {
  const connected = db
    .prepare(`SELECT * FROM repos WHERE enabled = 1`)
    .all() as ConnectedRepo[];
  if (connected.length) {
    return connected.map((r) => ({
      id: r.id,
      owner: r.owner,
      name: r.name,
      defaultBranch: r.default_branch,
      enabled: r.enabled === 1,
      repo_dir: r.repo_dir,
    }));
  }
  return botConfig.repos.map((r) => ({
    ...r,
    id: null,
    repo_dir: process.env.REPO_DIR ?? null,
  }));
}

export function getConnectedRepo(id: number): ConnectedRepo | null {
  return (
    (db.prepare(`SELECT * FROM repos WHERE id = ?`).get(id) as ConnectedRepo) ??
    null
  );
}

/**
 * Add a repo. Validates it exists and the GitHub token can see it before
 * persisting. Throws on auth/access failure so the UI can surface a useful
 * error.
 */
export async function connectRepo(args: {
  owner: string;
  name: string;
  repoDir?: string | null;
}): Promise<ConnectedRepo> {
  const owner = args.owner.trim();
  const name = args.name.trim();
  if (!owner || !name) throw new Error("owner + name required");

  // Probe GitHub. Uses installation token if the App is on this repo, falls
  // back to the PAT otherwise. Both validates auth and pulls default_branch.
  const probe = await ghFor(owner, name).repos.get({ owner, repo: name });

  const now = Date.now();
  db.prepare(
    `INSERT INTO repos (owner, name, default_branch, enabled, repo_dir, repo_url, description, created_at, updated_at)
     VALUES (?, ?, ?, 1, ?, ?, ?, ?, ?)
     ON CONFLICT(owner, name) DO UPDATE SET
       default_branch=excluded.default_branch,
       enabled=1,
       repo_dir=COALESCE(excluded.repo_dir, repos.repo_dir),
       repo_url=excluded.repo_url,
       description=excluded.description,
       updated_at=excluded.updated_at`,
  ).run(
    owner,
    name,
    probe.data.default_branch,
    args.repoDir ?? null,
    probe.data.html_url,
    probe.data.description ?? null,
    now,
    now,
  );
  const row = db
    .prepare(`SELECT * FROM repos WHERE owner=? AND name=?`)
    .get(owner, name) as ConnectedRepo;
  return row;
}

/**
 * Upsert a repo discovered via the GitHub App install callback. Unlike
 * `connectRepo`, this doesn't re-probe GitHub — the caller already has the
 * full metadata from the installation listing.
 */
export function upsertRepoFromInstallation(args: {
  owner: string;
  name: string;
  defaultBranch: string;
  installationId: number;
  htmlUrl: string;
  description: string | null;
  repoDir?: string | null;
}): ConnectedRepo {
  const now = Date.now();
  db.prepare(
    `INSERT INTO repos (owner, name, default_branch, enabled, repo_dir, repo_url, description, installation_id, created_at, updated_at)
     VALUES (?, ?, ?, 1, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(owner, name) DO UPDATE SET
       default_branch=excluded.default_branch,
       enabled=1,
       repo_dir=COALESCE(excluded.repo_dir, repos.repo_dir),
       repo_url=excluded.repo_url,
       description=excluded.description,
       installation_id=excluded.installation_id,
       updated_at=excluded.updated_at`,
  ).run(
    args.owner,
    args.name,
    args.defaultBranch,
    args.repoDir ?? null,
    args.htmlUrl,
    args.description,
    args.installationId,
    now,
    now,
  );
  return db
    .prepare(`SELECT * FROM repos WHERE owner=? AND name=?`)
    .get(args.owner, args.name) as ConnectedRepo;
}

export function updateConnectedRepo(
  id: number,
  patch: { enabled?: boolean; repo_dir?: string | null },
): ConnectedRepo | null {
  const existing = getConnectedRepo(id);
  if (!existing) return null;
  const enabled =
    patch.enabled === undefined ? existing.enabled : patch.enabled ? 1 : 0;
  const repoDir =
    patch.repo_dir === undefined ? existing.repo_dir : patch.repo_dir;
  db.prepare(
    `UPDATE repos SET enabled=?, repo_dir=?, updated_at=? WHERE id=?`,
  ).run(enabled, repoDir, Date.now(), id);
  return getConnectedRepo(id);
}

export function deleteConnectedRepo(id: number): boolean {
  const r = db.prepare(`DELETE FROM repos WHERE id = ?`).run(id);
  return r.changes > 0;
}
