import { mutation, query, action } from "./_generated/server";
import { v } from "convex/values";

export const lookup = query({
  args: { repo: v.string(), issue_number: v.number() },
  handler: async (ctx, { repo, issue_number }) => {
    return await ctx.db
      .query("issue_embeddings")
      .withIndex("by_repo_issue", (q) =>
        q.eq("repo", repo).eq("issue_number", issue_number),
      )
      .unique();
  },
});

export const upsert = mutation({
  args: {
    repo: v.string(),
    issue_number: v.number(),
    updated_at: v.string(),
    embedding: v.array(v.float64()),
    cached_at: v.number(),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("issue_embeddings")
      .withIndex("by_repo_issue", (q) =>
        q.eq("repo", args.repo).eq("issue_number", args.issue_number),
      )
      .unique();
    if (existing) {
      await ctx.db.patch(existing._id, {
        updated_at: args.updated_at,
        embedding: args.embedding,
        cached_at: args.cached_at,
      });
    } else {
      await ctx.db.insert("issue_embeddings", args);
    }
  },
});

export const pruneStale = mutation({
  args: { cutoff: v.number() },
  handler: async (ctx, { cutoff }) => {
    const stale = await ctx.db
      .query("issue_embeddings")
      .collect();
    const old = stale.filter((r) => r.cached_at < cutoff);
    for (const r of old) await ctx.db.delete(r._id);
    return old.length;
  },
});

export const vectorSearch = action({
  args: {
    embedding: v.array(v.float64()),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, { embedding, limit }) => {
    return await ctx.vectorSearch("issue_embeddings", "by_embedding", {
      vector: embedding,
      limit: limit ?? 16,
    });
  },
});
