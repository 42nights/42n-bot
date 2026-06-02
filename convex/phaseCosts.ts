import { mutation, query } from "./_generated/server";
import { v } from "convex/values";

export const insert = mutation({
  args: {
    run_id: v.id("runs"),
    phase: v.string(),
    attempt: v.number(),
    cost_usd: v.number(),
    duration_ms: v.number(),
    ok: v.number(),
    created_at: v.number(),
  },
  handler: async (ctx, args) => {
    return await ctx.db.insert("phase_costs", args);
  },
});

export const listByRun = query({
  args: { run_id: v.id("runs") },
  handler: async (ctx, { run_id }) => {
    return await ctx.db
      .query("phase_costs")
      .withIndex("by_run_phase", (q) => q.eq("run_id", run_id))
      .order("asc")
      .collect();
  },
});
