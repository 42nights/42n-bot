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
  args: { run_id: v.id("runs") },
  handler: async (ctx, { run_id }) => {
    return await ctx.db
      .query("artifacts")
      .withIndex("by_run_kind", (q) => q.eq("run_id", run_id))
      .collect();
  },
});

export const getLatestDiff = query({
  args: { run_id: v.id("runs") },
  handler: async (ctx, { run_id }) => {
    const rows = await ctx.db
      .query("artifacts")
      .withIndex("by_run_kind", (q) =>
        q.eq("run_id", run_id).eq("kind", "diff"),
      )
      .order("desc")
      .first();
    return rows ?? null;
  },
});
