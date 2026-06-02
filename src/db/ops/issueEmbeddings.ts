import { convex, api } from "../convex-client";

export type IssueEmbeddingRow = {
  _id: string;
  repo: string;
  issue_number: number;
  updated_at: string;
  embedding: number[];
  cached_at: number;
};

export async function lookupIssueEmbedding(
  repo: string,
  issue_number: number,
): Promise<IssueEmbeddingRow | null> {
  const row = await convex.query(api.issueEmbeddings.lookup, {
    repo,
    issue_number,
  });
  return (row as IssueEmbeddingRow | null) ?? null;
}

export async function upsertIssueEmbedding(args: {
  repo: string;
  issue_number: number;
  updated_at: string;
  embedding: number[];
  cached_at: number;
}): Promise<void> {
  await convex.mutation(api.issueEmbeddings.upsert, args);
}

export async function pruneStaleIssueEmbeddings(cutoff: number): Promise<number> {
  return convex.mutation(api.issueEmbeddings.pruneStale, { cutoff });
}
