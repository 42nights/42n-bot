import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import { Id } from "./_generated/dataModel";

// All statuses that count as "active" (not terminal).
const ACTIVE_STATUSES = [
  "queued",
  "planning",
  "implementing",
  "verifying",
  "iterating",
];

export const list = query({
  args: {
    status: v.optional(v.string()),
    type: v.optional(v.string()),
    repo: v.optional(v.string()),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, { status, type, repo, limit }) => {
    const maxRows = Math.min(limit ?? 50, 200);
    let rows = await ctx.db.query("runs").order("desc").collect();
    if (status) rows = rows.filter((r) => r.status === status);
    if (type) rows = rows.filter((r) => r.type === type);
    if (repo) rows = rows.filter((r) => r.repo === repo);
    return rows.slice(0, maxRows);
  },
});

export const getById = query({
  args: { id: v.id("runs") },
  handler: async (ctx, { id }) => {
    return await ctx.db.get(id);
  },
});

export const rollup24h = query({
  args: { repo: v.optional(v.string()) },
  handler: async (ctx, { repo }) => {
    const since = Date.now() - 24 * 60 * 60 * 1000;
    let rows = await ctx.db
      .query("runs")
      .withIndex("by_started_at", (q) => q.gte("started_at", since))
      .collect();
    if (repo) rows = rows.filter((r) => r.repo === repo);
    const total = rows.length;
    const shipped = rows.filter(
      (r) => r.status === "pr-opened" || r.status === "succeeded",
    ).length;
    const needs_review = rows.filter((r) => r.status === "needs-review").length;
    const abandoned = rows.filter((r) => r.status === "abandoned").length;
    const failed = rows.filter((r) => r.status === "failed").length;
    const cost_usd = rows.reduce((s, r) => s + r.cost_usd, 0);
    return { total, shipped, needs_review, abandoned, failed, cost_usd };
  },
});

export const getActiveForIssue = query({
  args: { repo: v.string(), issue_number: v.number() },
  handler: async (ctx, { repo, issue_number }) => {
    const rows = await ctx.db
      .query("runs")
      .withIndex("by_repo_issue", (q) =>
        q.eq("repo", repo).eq("issue_number", issue_number),
      )
      .collect();
    return rows.find((r) => ACTIVE_STATUSES.includes(r.status)) ?? null;
  },
});

export const getRecentFailsForIssue = query({
  args: {
    repo: v.string(),
    issue_number: v.number(),
    since: v.number(),
  },
  handler: async (ctx, { repo, issue_number, since }) => {
    const rows = await ctx.db
      .query("runs")
      .withIndex("by_repo_issue", (q) =>
        q.eq("repo", repo).eq("issue_number", issue_number),
      )
      .collect();
    return rows.filter(
      (r) =>
        (r.status === "failed" || r.status === "abandoned") &&
        r.started_at > since,
    ).length;
  },
});

export const getDayCost = query({
  args: { since: v.number() },
  handler: async (ctx, { since }) => {
    const rows = await ctx.db
      .query("runs")
      .withIndex("by_started_at", (q) => q.gte("started_at", since))
      .collect();
    return rows.reduce((s, r) => s + r.cost_usd, 0);
  },
});

export const getIssueCostAndCount = query({
  args: { repo: v.string(), issue_number: v.number() },
  handler: async (ctx, { repo, issue_number }) => {
    const rows = await ctx.db
      .query("runs")
      .withIndex("by_repo_issue", (q) =>
        q.eq("repo", repo).eq("issue_number", issue_number),
      )
      .collect();
    const spent = rows.reduce((s, r) => s + r.cost_usd, 0);
    return { spent, runs: rows.length };
  },
});

export const getByPrNumber = query({
  args: { pr_number: v.number() },
  handler: async (ctx, { pr_number }) => {
    return await ctx.db
      .query("runs")
      .withIndex("by_pr_number", (q) => q.eq("pr_number", pr_number))
      .order("desc")
      .first();
  },
});

export const getActiveRuns = query({
  args: {},
  handler: async (ctx) => {
    const all = await ctx.db.query("runs").order("desc").collect();
    return all.filter((r) => ACTIVE_STATUSES.includes(r.status)).slice(0, 20);
  },
});

export const getStaleWorktrees = query({
  args: { cutoff: v.number() },
  handler: async (ctx, { cutoff }) => {
    const rows = await ctx.db.query("runs").collect();
    return rows.filter(
      (r) =>
        r.worktree_path !== undefined &&
        r.finished_at !== undefined &&
        r.finished_at < cutoff,
    );
  },
});

export const getActiveRunsForRepoDir = query({
  args: { repoKeys: v.array(v.string()) },
  handler: async (ctx, { repoKeys }) => {
    const all = await ctx.db.query("runs").collect();
    const active = all.filter((r) => ACTIVE_STATUSES.includes(r.status));
    if (repoKeys.length === 0) return active;
    return active.filter((r) => repoKeys.includes(r.repo));
  },
});

export const getReposForDir = query({
  args: { repo_dir: v.string() },
  handler: async (ctx, { repo_dir }) => {
    const rows = await ctx.db.query("repos").collect();
    return rows.filter((r) => r.repo_dir === repo_dir);
  },
});

export const create = mutation({
  args: {
    type: v.string(),
    repo: v.string(),
    issue_number: v.optional(v.number()),
    issue_title: v.optional(v.string()),
    issue_body: v.optional(v.string()),
    status: v.string(),
    started_at: v.number(),
    is_system: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    return await ctx.db.insert("runs", {
      ...args,
      attempts: 0,
      cost_usd: 0,
    });
  },
});

// Atomic: insert only when no active run exists for this issue.
// Returns the new run id or null if one already exists.
export const createIfNoActive = mutation({
  args: {
    type: v.string(),
    repo: v.string(),
    issue_number: v.number(),
    issue_title: v.optional(v.string()),
    issue_body: v.optional(v.string()),
    status: v.string(),
    started_at: v.number(),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("runs")
      .withIndex("by_repo_issue", (q) =>
        q.eq("repo", args.repo).eq("issue_number", args.issue_number),
      )
      .collect();
    const hasActive = existing.some((r) => ACTIVE_STATUSES.includes(r.status));
    if (hasActive) return null;
    return await ctx.db.insert("runs", {
      type: args.type,
      repo: args.repo,
      issue_number: args.issue_number,
      issue_title: args.issue_title,
      issue_body: args.issue_body,
      status: args.status,
      started_at: args.started_at,
      attempts: 0,
      cost_usd: 0,
    });
  },
});

// Generic field patch — only allows known fields.
const PATCHABLE = new Set([
  "status",
  "branch_name",
  "pr_number",
  "pr_url",
  "worktree_path",
  "attempts",
  "cost_usd",
  "finished_at",
  "error_message",
  "issue_type",
  "understanding_json",
  "acceptance_test_paths_json",
  "runtime_verification_json",
  "replan_count",
]);

export const patch = mutation({
  args: {
    id: v.id("runs"),
    // Pass as JSON to avoid declaring every optional field in Convex's arg
    // validator — this is the internal coordinator path, not user input.
    patchJson: v.string(),
  },
  handler: async (ctx, { id, patchJson }) => {
    const incoming = JSON.parse(patchJson) as Record<string, unknown>;
    const safe: Record<string, unknown> = {};
    for (const [k, val] of Object.entries(incoming)) {
      if (!PATCHABLE.has(k))
        throw new Error(`patch: unknown field "${k}"`);
      safe[k] = val;
    }
    await ctx.db.patch(id, safe);
  },
});

export const incrementCost = mutation({
  args: { id: v.id("runs"), delta: v.number() },
  handler: async (ctx, { id, delta }) => {
    const run = await ctx.db.get(id);
    if (!run) return;
    await ctx.db.patch(id, { cost_usd: run.cost_usd + delta });
  },
});

export const getRunCost = query({
  args: { id: v.id("runs") },
  handler: async (ctx, { id }) => {
    const run = await ctx.db.get(id);
    return run?.cost_usd ?? 0;
  },
});

export const getRunsByRepoAndIssues = query({
  args: { repo: v.string(), issue_numbers: v.array(v.number()) },
  handler: async (ctx, { repo, issue_numbers }) => {
    const issueSet = new Set(issue_numbers);
    const rows = await ctx.db
      .query("runs")
      .withIndex("by_repo", (q) => q.eq("repo", repo))
      .order("desc")
      .collect();
    return rows.filter(
      (r) => r.issue_number !== undefined && issueSet.has(r.issue_number),
    );
  },
});

export const clearWorktreePaths = mutation({
  args: { ids: v.array(v.id("runs")) },
  handler: async (ctx, { ids }) => {
    for (const id of ids) {
      await ctx.db.patch(id, { worktree_path: undefined });
    }
  },
});

export const getSystemRun = query({
  args: {},
  handler: async (ctx) => {
    return await ctx.db
      .query("runs")
      .filter((q) => q.eq(q.field("is_system"), true))
      .first();
  },
});

export const ensureSystemRun = mutation({
  args: { started_at: v.number() },
  handler: async (ctx, { started_at }) => {
    const existing = await ctx.db
      .query("runs")
      .filter((q) => q.eq(q.field("is_system"), true))
      .first();
    if (existing) return existing._id;
    return await ctx.db.insert("runs", {
      type: "system",
      repo: "_system",
      status: "succeeded",
      started_at,
      attempts: 0,
      cost_usd: 0,
      is_system: true,
    });
  },
});

export const pruneOldRuns = mutation({
  args: { cutoff: v.number() },
  handler: async (ctx, { cutoff }) => {
    const rows = await ctx.db.query("runs").collect();
    const stale = rows.filter(
      (r) => r.finished_at !== undefined && r.finished_at < cutoff,
    );
    for (const r of stale) {
      // Cascade events, artifacts, verdicts, phase_costs
      const events = await ctx.db
        .query("events")
        .withIndex("by_run", (q) => q.eq("run_id", r._id))
        .collect();
      for (const e of events) await ctx.db.delete(e._id);

      const artifacts = await ctx.db
        .query("artifacts")
        .withIndex("by_run_kind", (q) => q.eq("run_id", r._id))
        .collect();
      for (const a of artifacts) await ctx.db.delete(a._id);

      const verdicts = await ctx.db
        .query("verdicts")
        .withIndex("by_run_attempt", (q) => q.eq("run_id", r._id))
        .collect();
      for (const vd of verdicts) await ctx.db.delete(vd._id);

      const phaseCosts = await ctx.db
        .query("phase_costs")
        .withIndex("by_run_phase", (q) => q.eq("run_id", r._id))
        .collect();
      for (const p of phaseCosts) await ctx.db.delete(p._id);

      await ctx.db.delete(r._id);
    }
    return stale.length;
  },
});

export const remove = mutation({
  args: { id: v.id("runs") },
  handler: async (ctx, { id }) => {
    await ctx.db.delete(id);
    return true;
  },
});
