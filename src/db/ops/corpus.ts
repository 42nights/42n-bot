import { convex, api } from "../convex-client";
import type { Id } from "../../../convex/_generated/dataModel";

export type CorpusChunkRow = {
  _id: string;
  run_id?: string;
  text: string;
  embedding?: number[];
  created_at: number;
};

export async function insertCorpusChunksBatch(
  chunks: Array<{
    run_id?: string;
    text: string;
    embedding?: number[] | null;
    created_at: number;
  }>,
): Promise<void> {
  // Convex recommends batches ≤ 50 for mutations with many inserts.
  const BATCH = 50;
  for (let i = 0; i < chunks.length; i += BATCH) {
    const slice = chunks.slice(i, i + BATCH);
    await convex.mutation(api.corpus.insertBatch, {
      chunks: slice.map((c) => ({
        run_id: c.run_id as Id<"runs"> | undefined,
        text: c.text,
        embedding: c.embedding ?? undefined,
        created_at: c.created_at,
      })),
    });
  }
}

export async function listRecentCorpusChunks(
  limit?: number,
): Promise<CorpusChunkRow[]> {
  const rows = await convex.query(api.corpus.listRecent, { limit });
  return rows as CorpusChunkRow[];
}

export async function getMissingCorpusRunIds(
  statuses: string[],
): Promise<string[]> {
  const ids = await convex.query(api.corpus.getMissingForRuns, { statuses });
  return ids as string[];
}
