import { mutation, query } from "./_generated/server";
import { v } from "convex/values";

export const list = query({
  args: {},
  handler: async (ctx) => {
    return await ctx.db
      .query("repos")
      .order("desc")
      .collect();
  },
});

export const listEnabled = query({
  args: {},
  handler: async (ctx) => {
    return await ctx.db
      .query("repos")
      .withIndex("by_enabled", (q) => q.eq("enabled", 1))
      .collect();
  },
});

export const getById = query({
  args: { id: v.id("repos") },
  handler: async (ctx, { id }) => {
    return await ctx.db.get(id);
  },
});

export const getByOwnerName = query({
  args: { owner: v.string(), name: v.string() },
  handler: async (ctx, { owner, name }) => {
    return await ctx.db
      .query("repos")
      .withIndex("by_owner_name", (q) => q.eq("owner", owner).eq("name", name))
      .unique();
  },
});

export const upsert = mutation({
  args: {
    owner: v.string(),
    name: v.string(),
    default_branch: v.string(),
    enabled: v.number(),
    repo_dir: v.optional(v.string()),
    repo_url: v.optional(v.string()),
    description: v.optional(v.string()),
    installation_id: v.optional(v.number()),
    created_at: v.number(),
    updated_at: v.number(),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("repos")
      .withIndex("by_owner_name", (q) =>
        q.eq("owner", args.owner).eq("name", args.name),
      )
      .unique();
    if (existing) {
      await ctx.db.patch(existing._id, {
        default_branch: args.default_branch,
        enabled: 1,
        repo_dir: args.repo_dir ?? existing.repo_dir,
        repo_url: args.repo_url ?? existing.repo_url,
        description: args.description ?? existing.description,
        installation_id: args.installation_id ?? existing.installation_id,
        updated_at: args.updated_at,
      });
      return existing._id;
    }
    return await ctx.db.insert("repos", args);
  },
});

export const update = mutation({
  args: {
    id: v.id("repos"),
    enabled: v.optional(v.number()),
    repo_dir: v.optional(v.string()),
    updated_at: v.number(),
  },
  handler: async (ctx, { id, enabled, repo_dir, updated_at }) => {
    const patch: Record<string, unknown> = { updated_at };
    if (enabled !== undefined) patch.enabled = enabled;
    if (repo_dir !== undefined) patch.repo_dir = repo_dir;
    await ctx.db.patch(id, patch);
    return await ctx.db.get(id);
  },
});

export const remove = mutation({
  args: { id: v.id("repos") },
  handler: async (ctx, { id }) => {
    await ctx.db.delete(id);
    return true;
  },
});
