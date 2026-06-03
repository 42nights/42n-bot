import { mutation, query } from "./_generated/server";
import { v } from "convex/values";

export const listThreads = query({
  args: {},
  handler: async (ctx) => {
    return await ctx.db
      .query("chat_threads")
      .withIndex("by_updated_at")
      .order("desc")
      .take(50);
  },
});

export const createThread = mutation({
  args: { title: v.string(), created_at: v.number(), updated_at: v.number() },
  handler: async (ctx, args) => {
    return await ctx.db.insert("chat_threads", args);
  },
});

export const getThread = query({
  args: { id: v.id("chat_threads") },
  handler: async (ctx, { id }) => {
    return await ctx.db.get(id);
  },
});

export const touchThread = mutation({
  args: { id: v.id("chat_threads"), updated_at: v.number() },
  handler: async (ctx, { id, updated_at }) => {
    await ctx.db.patch(id, { updated_at });
  },
});

export const listMessages = query({
  args: { thread_id: v.id("chat_threads") },
  handler: async (ctx, { thread_id }) => {
    return await ctx.db
      .query("chat_messages")
      .withIndex("by_thread", (q) => q.eq("thread_id", thread_id))
      .order("asc")
      .collect();
  },
});

export const insertMessage = mutation({
  args: {
    thread_id: v.id("chat_threads"),
    role: v.string(),
    content: v.string(),
    citations_json: v.optional(v.string()),
    created_at: v.number(),
  },
  handler: async (ctx, args) => {
    return await ctx.db.insert("chat_messages", args);
  },
});

export const deleteThread = mutation({
  args: { thread_id: v.id("chat_threads") },
  handler: async (ctx, { thread_id }) => {
    const messages = await ctx.db
      .query("chat_messages")
      .withIndex("by_thread", (q) => q.eq("thread_id", thread_id))
      .collect();
    for (const m of messages) await ctx.db.delete(m._id);
    await ctx.db.delete(thread_id);
    return true;
  },
});
