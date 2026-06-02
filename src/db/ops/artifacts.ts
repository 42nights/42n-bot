import { convex, api } from "../convex-client";
import type { Id } from "../../../convex/_generated/dataModel";

export type ArtifactRow = {
  _id: string;
  run_id: string;
  kind: string;
  content: string;
  created_at: number;
};

export async function insertArtifact(
  run_id: string,
  kind: string,
  content: string,
): Promise<void> {
  await convex.mutation(api.artifacts.insert, {
    run_id: run_id as Id<"runs">,
    kind,
    content,
    created_at: Date.now(),
  });
}

export async function listArtifactsByRun(run_id: string): Promise<ArtifactRow[]> {
  const rows = await convex.query(api.artifacts.listByRun, {
    run_id: run_id as Id<"runs">,
  });
  return rows as ArtifactRow[];
}

export async function getLatestDiff(run_id: string): Promise<ArtifactRow | null> {
  const row = await convex.query(api.artifacts.getLatestDiff, {
    run_id: run_id as Id<"runs">,
  });
  return (row as ArtifactRow | null) ?? null;
}
