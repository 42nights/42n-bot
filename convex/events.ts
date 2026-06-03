import { mutation, query } from "./_generated/server";
import { v } from "convex/values";

export const insertEvent = mutation({
  args: {
    run_id: v.id("runs"),
    ts: v.number(),
    kind: v.string(),
    payload_json: v.string(),
  },
  handler: async (ctx, args) => {
    return await ctx.db.insert("events", args);
  },
});

export const listByRun = query({
  args: { run_id: v.string() },
  handler: async (ctx, { run_id }) => {
    const runId = ctx.db.normalizeId("runs", run_id);
    if (!runId) return [];
    return await ctx.db
      .query("events")
      .withIndex("by_run", (q) => q.eq("run_id", runId))
      .order("asc")
      .collect();
  },
});

export const listByRunSince = query({
  args: { run_id: v.id("runs"), since_ts: v.number() },
  handler: async (ctx, { run_id, since_ts }) => {
    return await ctx.db
      .query("events")
      .withIndex("by_run", (q) =>
        q.eq("run_id", run_id).gt("ts", since_ts),
      )
      .order("asc")
      .collect();
  },
});

// For the SSE stream: fetch all events for a run, optionally after a given convex id.
export const listByRunAfterCursor = query({
  args: {
    run_id: v.string(),
    after_created: v.optional(v.number()),
  },
  handler: async (ctx, { run_id, after_created }) => {
    const runId = ctx.db.normalizeId("runs", run_id);
    if (!runId) return [];
    const q = ctx.db
      .query("events")
      .withIndex("by_run", (q2) => q2.eq("run_id", runId))
      .order("asc");
    const rows = await q.collect();
    if (after_created !== undefined) {
      return rows.filter((e) => e._creationTime > after_created);
    }
    return rows;
  },
});
