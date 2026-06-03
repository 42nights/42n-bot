import { mutation, query } from "./_generated/server";
import { v } from "convex/values";

export const insert = mutation({
  args: {
    run_id: v.id("runs"),
    attempt: v.number(),
    pass: v.number(),
    checks_json: v.string(),
    failure_summary: v.optional(v.string()),
    created_at: v.number(),
  },
  handler: async (ctx, args) => {
    return await ctx.db.insert("verdicts", args);
  },
});

export const listByRun = query({
  args: { run_id: v.string() },
  handler: async (ctx, { run_id }) => {
    const runId = ctx.db.normalizeId("runs", run_id);
    if (!runId) return [];
    return await ctx.db
      .query("verdicts")
      .withIndex("by_run_attempt", (q) => q.eq("run_id", runId))
      .order("asc")
      .collect();
  },
});
