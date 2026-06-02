import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  repos: defineTable({
    owner: v.string(),
    name: v.string(),
    default_branch: v.string(),
    enabled: v.number(), // 0|1
    repo_dir: v.optional(v.string()),
    repo_url: v.optional(v.string()),
    description: v.optional(v.string()),
    installation_id: v.optional(v.number()),
    created_at: v.number(),
    updated_at: v.number(),
  })
    .index("by_owner_name", ["owner", "name"])
    .index("by_enabled", ["enabled"]),

  runs: defineTable({
    type: v.string(), // "implement" | "review" | "system"
    repo: v.string(), // "owner/name"
    issue_number: v.optional(v.number()),
    issue_title: v.optional(v.string()),
    issue_body: v.optional(v.string()),
    branch_name: v.optional(v.string()),
    pr_number: v.optional(v.number()),
    pr_url: v.optional(v.string()),
    status: v.string(),
    worktree_path: v.optional(v.string()),
    attempts: v.number(),
    cost_usd: v.number(),
    started_at: v.number(),
    finished_at: v.optional(v.number()),
    error_message: v.optional(v.string()),
    // v0.2 phase fields
    issue_type: v.optional(v.string()),
    understanding_json: v.optional(v.string()),
    acceptance_test_paths_json: v.optional(v.string()),
    runtime_verification_json: v.optional(v.string()),
    replan_count: v.optional(v.number()),
    // system-run sentinel: SQLite used id=0; Convex uses a dedicated flag
    is_system: v.optional(v.boolean()),
  })
    .index("by_repo", ["repo"])
    .index("by_status", ["status"])
    .index("by_repo_issue", ["repo", "issue_number"])
    .index("by_started_at", ["started_at"])
    .index("by_pr_number", ["pr_number"]),

  events: defineTable({
    run_id: v.id("runs"),
    ts: v.number(),
    kind: v.string(),
    payload_json: v.string(),
  })
    .index("by_run", ["run_id", "ts"])
    .index("by_kind", ["kind"]),

  artifacts: defineTable({
    run_id: v.id("runs"),
    kind: v.string(), // plan|diff|test_output|lint_output|critic_report|understanding|reproduce|design|replan-*
    content: v.string(),
    created_at: v.number(),
  })
    .index("by_run_kind", ["run_id", "kind"]),

  verdicts: defineTable({
    run_id: v.id("runs"),
    attempt: v.number(),
    pass: v.number(), // 0|1
    checks_json: v.string(),
    failure_summary: v.optional(v.string()),
    created_at: v.number(),
  })
    .index("by_run_attempt", ["run_id", "attempt"]),

  corpus_chunks: defineTable({
    run_id: v.optional(v.id("runs")),
    text: v.string(),
    embedding: v.optional(v.array(v.float64())),
    created_at: v.number(),
  })
    .index("by_run", ["run_id"])
    .index("by_created_at", ["created_at"])
    .vectorIndex("by_embedding", {
      vectorField: "embedding",
      dimensions: 1536,
    }),

  chat_threads: defineTable({
    title: v.string(),
    created_at: v.number(),
    updated_at: v.number(),
  }).index("by_updated_at", ["updated_at"]),

  chat_messages: defineTable({
    thread_id: v.id("chat_threads"),
    role: v.string(), // "user" | "assistant"
    content: v.string(),
    citations_json: v.optional(v.string()),
    created_at: v.number(),
  }).index("by_thread", ["thread_id", "created_at"]),

  dispatch_signals: defineTable({
    name: v.string(), // "implementer" | "reviewer"
    dirty: v.number(), // 0|1
    updated_at: v.number(),
  }).index("by_name", ["name"]),

  issue_embeddings: defineTable({
    repo: v.string(),
    issue_number: v.number(),
    updated_at: v.string(), // GitHub ISO updated_at
    embedding: v.array(v.float64()),
    cached_at: v.number(),
  })
    .index("by_repo_issue", ["repo", "issue_number"])
    .index("by_repo", ["repo"])
    .vectorIndex("by_embedding", {
      vectorField: "embedding",
      dimensions: 1536,
    }),

  phase_costs: defineTable({
    run_id: v.id("runs"),
    phase: v.string(),
    attempt: v.number(),
    cost_usd: v.number(),
    duration_ms: v.number(),
    ok: v.number(), // 0|1
    created_at: v.number(),
  }).index("by_run_phase", ["run_id", "phase"]),

  webhook_deliveries: defineTable({
    delivery_id: v.string(),
    event: v.optional(v.string()),
    received_at: v.number(),
  })
    .index("by_delivery_id", ["delivery_id"])
    .index("by_received_at", ["received_at"]),

  crons: defineTable({
    name: v.string(),
    schedule: v.string(),
    action: v.string(), // "reviewer" | "fix_issue" | "send_otis"
    payload_json: v.string(),
    repo: v.optional(v.string()),
    enabled: v.number(), // 0|1
    last_run_at: v.optional(v.number()),
    next_run_at: v.optional(v.number()),
    created_at: v.number(),
    updated_at: v.number(),
  })
    .index("by_next_run", ["next_run_at"])
    .index("by_enabled", ["enabled"]),

  cron_runs: defineTable({
    cron_id: v.id("crons"),
    started_at: v.number(),
    finished_at: v.optional(v.number()),
    ok: v.number(), // 0|1
    message: v.optional(v.string()),
    run_id: v.optional(v.id("runs")),
  }).index("by_cron", ["cron_id", "started_at"]),

  app_credentials: defineTable({
    // Singleton: always upserted at the same stable document id stored in
    // app_singleton_key. We store it in the table as a normal row, using
    // by_singleton index to fetch it.
    singleton_key: v.string(), // always "1"
    app_id: v.number(),
    slug: v.string(),
    client_id: v.optional(v.string()),
    client_secret: v.optional(v.string()),
    webhook_secret: v.optional(v.string()),
    private_key_b64: v.string(),
    created_at: v.number(),
  }).index("by_singleton", ["singleton_key"]),

  app_setup_state: defineTable({
    state: v.string(),
    created_at: v.number(),
  }).index("by_state", ["state"]),
});
