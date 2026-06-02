import { mutation, query } from "./_generated/server";
import { v } from "convex/values";

const SINGLETON_KEY = "1";

export const get = query({
  args: {},
  handler: async (ctx) => {
    return await ctx.db
      .query("app_credentials")
      .withIndex("by_singleton", (q) => q.eq("singleton_key", SINGLETON_KEY))
      .unique();
  },
});

export const save = mutation({
  args: {
    app_id: v.number(),
    slug: v.string(),
    client_id: v.optional(v.string()),
    client_secret: v.optional(v.string()),
    webhook_secret: v.optional(v.string()),
    private_key_b64: v.string(),
    created_at: v.number(),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("app_credentials")
      .withIndex("by_singleton", (q) => q.eq("singleton_key", SINGLETON_KEY))
      .unique();
    const row = { ...args, singleton_key: SINGLETON_KEY };
    if (existing) {
      await ctx.db.patch(existing._id, row);
    } else {
      await ctx.db.insert("app_credentials", row);
    }
  },
});

export const listSetupStates = query({
  args: {},
  handler: async (ctx) => {
    return await ctx.db.query("app_setup_state").collect();
  },
});

export const insertSetupState = mutation({
  args: { state: v.string(), created_at: v.number() },
  handler: async (ctx, args) => {
    await ctx.db.insert("app_setup_state", args);
  },
});

export const getSetupState = query({
  args: { state: v.string() },
  handler: async (ctx, { state }) => {
    return await ctx.db
      .query("app_setup_state")
      .withIndex("by_state", (q) => q.eq("state", state))
      .unique();
  },
});

export const deleteSetupState = mutation({
  args: { state: v.string() },
  handler: async (ctx, { state }) => {
    const row = await ctx.db
      .query("app_setup_state")
      .withIndex("by_state", (q) => q.eq("state", state))
      .unique();
    if (row) await ctx.db.delete(row._id);
  },
});

export const pruneSetupStates = mutation({
  args: { cutoff: v.number() },
  handler: async (ctx, { cutoff }) => {
    const stale = await ctx.db
      .query("app_setup_state")
      .collect();
    const old = stale.filter((s) => s.created_at < cutoff);
    for (const s of old) await ctx.db.delete(s._id);
  },
});
