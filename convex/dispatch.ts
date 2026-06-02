import { mutation, query } from "./_generated/server";
import { v } from "convex/values";

export const request = mutation({
  args: { name: v.string(), updated_at: v.number() },
  handler: async (ctx, { name, updated_at }) => {
    const existing = await ctx.db
      .query("dispatch_signals")
      .withIndex("by_name", (q) => q.eq("name", name))
      .unique();
    if (existing) {
      await ctx.db.patch(existing._id, { dirty: 1, updated_at });
    } else {
      await ctx.db.insert("dispatch_signals", { name, dirty: 1, updated_at });
    }
  },
});

// Atomic consume: set dirty=0 only if it was 1. Returns true if it was dirty.
export const consume = mutation({
  args: { name: v.string(), updated_at: v.number() },
  handler: async (ctx, { name, updated_at }) => {
    const row = await ctx.db
      .query("dispatch_signals")
      .withIndex("by_name", (q) => q.eq("name", name))
      .unique();
    if (!row || row.dirty === 0) return false;
    await ctx.db.patch(row._id, { dirty: 0, updated_at });
    return true;
  },
});
