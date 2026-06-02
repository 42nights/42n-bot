import { mutation, query } from "./_generated/server";
import { v } from "convex/values";

// Returns true if inserted (first time), false if delivery_id already existed.
export const claimDelivery = mutation({
  args: {
    delivery_id: v.string(),
    event: v.optional(v.string()),
    received_at: v.number(),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("webhook_deliveries")
      .withIndex("by_delivery_id", (q) =>
        q.eq("delivery_id", args.delivery_id),
      )
      .unique();
    if (existing) return false;
    await ctx.db.insert("webhook_deliveries", args);
    return true;
  },
});

export const pruneOld = mutation({
  args: { cutoff: v.number() },
  handler: async (ctx, { cutoff }) => {
    const old = await ctx.db
      .query("webhook_deliveries")
      .withIndex("by_received_at", (q) => q.lt("received_at", cutoff))
      .collect();
    for (const r of old) await ctx.db.delete(r._id);
    return old.length;
  },
});
