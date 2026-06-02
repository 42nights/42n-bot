import { ghFor } from "./github/client";
import { botConfig, type BotRepo } from "../bot.config";
import {
  listRepos,
  listEnabledRepos,
  getRepoById,
  getRepoByOwnerName,
  upsertRepo,
  updateRepo,
  deleteRepo,
  type ConnectedRepo,
} from "./db/ops/repos";

export type { ConnectedRepo };

export async function listConnectedRepos(): Promise<ConnectedRepo[]> {
  return listRepos();
}

export async function activeRepos(): Promise<
  Array<BotRepo & { repo_dir: string | null; id: string | null }>
> {
  const connected = await listEnabledRepos();
  if (connected.length) {
    return connected.map((r) => ({
      id: r._id,
      owner: r.owner,
      name: r.name,
      defaultBranch: r.default_branch,
      enabled: r.enabled === 1,
      repo_dir: r.repo_dir ?? null,
    }));
  }
  return botConfig.repos.map((r) => ({
    ...r,
    id: null,
    repo_dir: process.env.REPO_DIR ?? null,
  }));
}

export async function getConnectedRepo(id: string): Promise<ConnectedRepo | null> {
  return getRepoById(id);
}

export async function connectRepo(args: {
  owner: string;
  name: string;
  repoDir?: string | null;
}): Promise<ConnectedRepo> {
  const owner = args.owner.trim();
  const name = args.name.trim();
  if (!owner || !name) throw new Error("owner + name required");

  const probe = await ghFor(owner, name).repos.get({ owner, repo: name });

  const now = Date.now();
  const id = await upsertRepo({
    owner,
    name,
    default_branch: probe.data.default_branch,
    enabled: 1,
    repo_dir: args.repoDir ?? null,
    repo_url: probe.data.html_url,
    description: probe.data.description ?? null,
    created_at: now,
    updated_at: now,
  });
  const row = await getRepoByOwnerName(owner, name);
  if (!row) throw new Error("upsert succeeded but row missing");
  return row;
}

export async function upsertRepoFromInstallation(args: {
  owner: string;
  name: string;
  defaultBranch: string;
  installationId: number;
  htmlUrl: string;
  description: string | null;
  repoDir?: string | null;
}): Promise<ConnectedRepo> {
  const now = Date.now();
  await upsertRepo({
    owner: args.owner,
    name: args.name,
    default_branch: args.defaultBranch,
    enabled: 1,
    repo_dir: args.repoDir ?? null,
    repo_url: args.htmlUrl,
    description: args.description,
    installation_id: args.installationId,
    created_at: now,
    updated_at: now,
  });
  const row = await getRepoByOwnerName(args.owner, args.name);
  if (!row) throw new Error("upsert succeeded but row missing");
  return row;
}

export async function updateConnectedRepo(
  id: string,
  patch: { enabled?: boolean; repo_dir?: string | null },
): Promise<ConnectedRepo | null> {
  const existing = await getRepoById(id);
  if (!existing) return null;
  const enabledNum =
    patch.enabled === undefined ? existing.enabled : patch.enabled ? 1 : 0;
  const repoDir =
    patch.repo_dir === undefined ? existing.repo_dir : patch.repo_dir;
  return updateRepo(id, { enabled: enabledNum, repo_dir: repoDir ?? null });
}

export async function deleteConnectedRepo(id: string): Promise<boolean> {
  return deleteRepo(id);
}
