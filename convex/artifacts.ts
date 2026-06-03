import { mutation, query } from "./_generated/server";
import { v } from "convex/values";

export const insert = mutation({
  args: {
    run_id: v.id("runs"),
    kind: v.string(),
    content: v.string(),
    created_at: v.number(),
  },
  handler: async (ctx, args) => {
    return await ctx.db.insert("artifacts", args);
  },
});

export const listByRun = query({
  args: { run_id: v.string() },
  handler: async (ctx, { run_id }) => {
    const runId = ctx.db.normalizeId("runs", run_id);
    if (!runId) return [];
    return await ctx.db
      .query("artifacts")
      .withIndex("by_run_kind", (q) => q.eq("run_id", runId))
      .collect();
  },
});

export const getLatestDiff = query({
  args: { run_id: v.string() },
  handler: async (ctx, { run_id }) => {
    const runId = ctx.db.normalizeId("runs", run_id);
    if (!runId) return null;
    const rows = await ctx.db
      .query("artifacts")
      .withIndex("by_run_kind", (q) =>
        q.eq("run_id", runId).eq("kind", "diff"),
      )
      .order("desc")
      .first();
    return rows ?? null;
  },
});
