import { mutation, query, action } from "./_generated/server";
import { v } from "convex/values";
import { api } from "./_generated/api";

export const insertBatch = mutation({
  args: {
    chunks: v.array(
      v.object({
        run_id: v.optional(v.id("runs")),
        text: v.string(),
        embedding: v.optional(v.array(v.float64())),
        created_at: v.number(),
      }),
    ),
  },
  handler: async (ctx, { chunks }) => {
    const ids: string[] = [];
    for (const chunk of chunks) {
      const id = await ctx.db.insert("corpus_chunks", chunk);
      ids.push(id);
    }
    return ids;
  },
});

export const listRecent = query({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, { limit }) => {
    return await ctx.db
      .query("corpus_chunks")
      .withIndex("by_created_at")
      .order("desc")
      .take(limit ?? 5000);
  },
});

export const getMissingForRuns = query({
  args: { statuses: v.array(v.string()) },
  handler: async (ctx, { statuses }) => {
    const statusSet = new Set(statuses);
    const runs = await ctx.db.query("runs").collect();
    const covered = await ctx.db.query("corpus_chunks").collect();
    const coveredRunIds = new Set(
      covered
        .filter((c) => c.run_id !== undefined)
        .map((c) => c.run_id as string),
    );
    return runs
      .filter((r) => statusSet.has(r.status) && !coveredRunIds.has(r._id))
      .map((r) => r._id);
  },
});

export const getById = query({
  args: { id: v.id("corpus_chunks") },
  handler: async (ctx, { id }) => {
    return await ctx.db.get(id);
  },
});

export const vectorSearch = action({
  args: {
    embedding: v.array(v.float64()),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, { embedding, limit }): Promise<Array<Record<string, unknown>>> => {
    const results = await ctx.vectorSearch("corpus_chunks", "by_embedding", {
      vector: embedding,
      limit: limit ?? 16,
    });
    const docs: Array<Record<string, unknown>> = [];
    for (const r of results) {
      const doc = await ctx.runQuery(api.corpus.getById, { id: r._id });
      if (doc) {
        docs.push({ ...doc as Record<string, unknown>, _score: r._score });
      }
    }
    return docs;
  },
});
