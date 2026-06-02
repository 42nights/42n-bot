import { mutation, query } from "./_generated/server";
import { v } from "convex/values";

export const list = query({
  args: {},
  handler: async (ctx) => {
    return await ctx.db
      .query("crons")
      .order("asc")
      .collect();
  },
});

export const getById = query({
  args: { id: v.id("crons") },
  handler: async (ctx, { id }) => {
    return await ctx.db.get(id);
  },
});

export const create = mutation({
  args: {
    name: v.string(),
    schedule: v.string(),
    action: v.string(),
    payload_json: v.string(),
    repo: v.optional(v.string()),
    enabled: v.number(),
    next_run_at: v.optional(v.number()),
    created_at: v.number(),
    updated_at: v.number(),
  },
  handler: async (ctx, args) => {
    return await ctx.db.insert("crons", args);
  },
});

export const update = mutation({
  args: {
    id: v.id("crons"),
    patchJson: v.string(),
  },
  handler: async (ctx, { id, patchJson }) => {
    const patch = JSON.parse(patchJson) as Record<string, unknown>;
    await ctx.db.patch(id, patch);
    return await ctx.db.get(id);
  },
});

export const remove = mutation({
  args: { id: v.id("crons") },
  handler: async (ctx, { id }) => {
    await ctx.db.delete(id);
    return true;
  },
});

export const getDue = query({
  args: { now: v.number(), limit: v.optional(v.number()) },
  handler: async (ctx, { now, limit }) => {
    const rows = await ctx.db
      .query("crons")
      .withIndex("by_enabled", (q) => q.eq("enabled", 1))
      .collect();
    return rows
      .filter((r) => r.next_run_at !== undefined && r.next_run_at <= now)
      .sort((a, b) => (a.next_run_at ?? 0) - (b.next_run_at ?? 0))
      .slice(0, limit ?? 10);
  },
});

// Atomic claim: advance next_run_at only if it still matches what the caller read.
// Returns true if claimed.
export const claimDue = mutation({
  args: {
    id: v.id("crons"),
    expected_next_run_at: v.optional(v.number()),
    new_next_run_at: v.optional(v.number()),
    now: v.number(),
  },
  handler: async (ctx, { id, expected_next_run_at, new_next_run_at, now }) => {
    const row = await ctx.db.get(id);
    if (!row) return false;
    if (row.next_run_at !== expected_next_run_at) return false;
    await ctx.db.patch(id, {
      next_run_at: new_next_run_at,
      last_run_at: now,
      updated_at: now,
    });
    return true;
  },
});

export const listCronRuns = query({
  args: { cron_id: v.id("crons"), limit: v.optional(v.number()) },
  handler: async (ctx, { cron_id, limit }) => {
    return await ctx.db
      .query("cron_runs")
      .withIndex("by_cron", (q) => q.eq("cron_id", cron_id))
      .order("desc")
      .take(limit ?? 50);
  },
});

export const recordCronRun = mutation({
  args: {
    cron_id: v.id("crons"),
    started_at: v.number(),
    finished_at: v.optional(v.number()),
    ok: v.number(),
    message: v.optional(v.string()),
    run_id: v.optional(v.id("runs")),
  },
  handler: async (ctx, args) => {
    // Guard: if the cron was deleted before this write, skip.
    const cron = await ctx.db.get(args.cron_id);
    if (!cron) return;
    await ctx.db.insert("cron_runs", args);
  },
});

export const pruneCronRuns = mutation({
  args: { cutoff: v.number() },
  handler: async (ctx, { cutoff }) => {
    const all = await ctx.db.query("cron_runs").collect();
    const old = all.filter((r) => r.started_at < cutoff);
    for (const r of old) await ctx.db.delete(r._id);
    return old.length;
  },
});
