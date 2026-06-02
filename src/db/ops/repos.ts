import { convex, api } from "../convex-client";
import type { Id } from "../../../convex/_generated/dataModel";

export type ConnectedRepo = {
  _id: string;
  owner: string;
  name: string;
  default_branch: string;
  enabled: number;
  repo_dir?: string;
  repo_url?: string;
  description?: string;
  installation_id?: number;
  created_at: number;
  updated_at: number;
};

export async function listRepos(): Promise<ConnectedRepo[]> {
  const rows = await convex.query(api.repos.list, {});
  return rows as ConnectedRepo[];
}

export async function listEnabledRepos(): Promise<ConnectedRepo[]> {
  const rows = await convex.query(api.repos.listEnabled, {});
  return rows as ConnectedRepo[];
}

export async function getRepoById(id: string): Promise<ConnectedRepo | null> {
  const row = await convex.query(api.repos.getById, {
    id: id as Id<"repos">,
  });
  return (row as ConnectedRepo | null) ?? null;
}

export async function getRepoByOwnerName(
  owner: string,
  name: string,
): Promise<ConnectedRepo | null> {
  const row = await convex.query(api.repos.getByOwnerName, { owner, name });
  return (row as ConnectedRepo | null) ?? null;
}

export async function upsertRepo(args: {
  owner: string;
  name: string;
  default_branch: string;
  enabled: number;
  repo_dir?: string | null;
  repo_url?: string | null;
  description?: string | null;
  installation_id?: number | null;
  created_at: number;
  updated_at: number;
}): Promise<string> {
  const id = await convex.mutation(api.repos.upsert, {
    owner: args.owner,
    name: args.name,
    default_branch: args.default_branch,
    enabled: args.enabled,
    repo_dir: args.repo_dir ?? undefined,
    repo_url: args.repo_url ?? undefined,
    description: args.description ?? undefined,
    installation_id: args.installation_id ?? undefined,
    created_at: args.created_at,
    updated_at: args.updated_at,
  });
  return id as string;
}

export async function updateRepo(
  id: string,
  patch: { enabled?: number; repo_dir?: string | null },
): Promise<ConnectedRepo | null> {
  const row = await convex.mutation(api.repos.update, {
    id: id as Id<"repos">,
    enabled: patch.enabled,
    repo_dir: patch.repo_dir ?? undefined,
    updated_at: Date.now(),
  });
  return (row as ConnectedRepo | null) ?? null;
}

export async function deleteRepo(id: string): Promise<boolean> {
  return convex.mutation(api.repos.remove, { id: id as Id<"repos"> });
}
