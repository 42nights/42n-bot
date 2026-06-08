import { mutation, query } from "./_generated/server";
import { v } from "convex/values";

const SINGLETON_KEY = "1";

/**
 * Convex public queries are callable by anyone holding the deployment URL.
 * The app_credentials row holds the GitHub App RSA private key, OAuth client
 * secret, and webhook secret — none of which may ever leave the deployment to
 * an unauthenticated caller. `get` is therefore split:
 *
 *  - secret fields (private_key_b64, client_secret, webhook_secret) are only
 *    returned when the caller presents the shared server token that matches the
 *    Convex-side `OTIS_SERVER_SECRET` env var. The Next server holds this token;
 *    a browser does not.
 *  - non-secret fields (app_id, slug, client_id) always return so the install
 *    UI and `appConfigured()`/`dbAppSlug()` keep working.
 *
 * Fail-closed: if `OTIS_SERVER_SECRET` is not set on the deployment, or the
 * presented token doesn't match, the secret fields are stripped. The server
 * then falls back to its own env-var credentials.
 */
function serverTokenOk(token: string | undefined): boolean {
  const expected = process.env.OTIS_SERVER_SECRET;
  if (!expected || !token) return false;
  if (token.length !== expected.length) return false;
  // Convex's V8 runtime has no node:crypto; constant-time compare by hand.
  let diff = 0;
  for (let i = 0; i < expected.length; i++) {
    diff |= token.charCodeAt(i) ^ expected.charCodeAt(i);
  }
  return diff === 0;
}

export const get = query({
  args: { serverToken: v.optional(v.string()) },
  handler: async (ctx, { serverToken }) => {
    const row = await ctx.db
      .query("app_credentials")
      .withIndex("by_singleton", (q) => q.eq("singleton_key", SINGLETON_KEY))
      .unique();
    if (!row) return null;
    if (serverTokenOk(serverToken)) return row;
    // Strip every secret field for unauthenticated/browser callers.
    const { private_key_b64: _pk, client_secret: _cs, webhook_secret: _ws, ...safe } = row;
    return safe;
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
