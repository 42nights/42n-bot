/* eslint-disable no-console */
import { ensureSchema } from "../src/db/migrate";
import { db } from "../src/db";

ensureSchema();

// Wipe (idempotent reseed).
db.exec(`DELETE FROM events; DELETE FROM verdicts; DELETE FROM artifacts; DELETE FROM corpus_chunks; DELETE FROM chat_messages; DELETE FROM chat_threads; DELETE FROM runs;`);
db.exec(`DELETE FROM sqlite_sequence WHERE name IN ('runs','events','verdicts','artifacts','corpus_chunks','chat_threads','chat_messages')`);

const now = Date.now();
const min = 60 * 1000;
const hour = 60 * min;

function insertRun(args: {
  type: "implement" | "review";
  repo: string;
  issue_number: number | null;
  issue_title: string | null;
  issue_body?: string | null;
  branch_name: string | null;
  pr_number: number | null;
  pr_url: string | null;
  status: string;
  attempts: number;
  cost_usd: number;
  started_at: number;
  finished_at: number | null;
  error_message?: string | null;
}): number {
  const info = db.prepare(`
    INSERT INTO runs (type, repo, issue_number, issue_title, issue_body, branch_name,
      pr_number, pr_url, status, attempts, cost_usd, started_at, finished_at, error_message)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    args.type, args.repo, args.issue_number, args.issue_title,
    args.issue_body ?? null, args.branch_name, args.pr_number, args.pr_url,
    args.status, args.attempts, args.cost_usd, args.started_at, args.finished_at,
    args.error_message ?? null,
  );
  return Number(info.lastInsertRowid);
}

function insertEvent(runId: number, ts: number, kind: string, payload: unknown = {}) {
  db.prepare(`INSERT INTO events (run_id, ts, kind, payload_json) VALUES (?, ?, ?, ?)`)
    .run(runId, ts, kind, JSON.stringify(payload));
}

function insertVerdict(runId: number, attempt: number, pass: boolean, checks: Record<string, any>, failureSummary: string) {
  db.prepare(`INSERT INTO verdicts (run_id, attempt, pass, checks_json, failure_summary, created_at) VALUES (?, ?, ?, ?, ?, ?)`)
    .run(runId, attempt, pass ? 1 : 0, JSON.stringify(checks), failureSummary, Date.now());
}

function insertArtifact(runId: number, kind: string, content: string) {
  db.prepare(`INSERT INTO artifacts (run_id, kind, content, created_at) VALUES (?, ?, ?, ?)`)
    .run(runId, kind, content, Date.now());
}

const passingChecks = {
  typecheck: { name: "typecheck", pass: true, hardGate: true, message: "Typecheck passed." },
  existing_tests: { name: "existing_tests", pass: true, hardGate: true, message: "Test suite passed." },
  plan_tests_added: { name: "plan_tests_added", pass: true, hardGate: true, message: "All planned test files are in the diff." },
  mutation_light: { name: "mutation_light", pass: true, hardGate: true, message: "Mutation-light passed: new tests fail without impl, pass with it." },
  lint: { name: "lint", pass: true, hardGate: false, message: "Lint clean." },
  diff_size: { name: "diff_size", pass: true, hardGate: false, message: "Diff is 47 lines (cap 1000)." },
  banned_patterns: { name: "banned_patterns", pass: true, hardGate: true, message: "No banned patterns introduced." },
  critic: {
    name: "critic", pass: true, hardGate: false,
    message: "Critic: 84/100 — Tight retry logic with explicit backoff; tests cover the happy path and the 503-then-200 sequence.",
    detail: {
      merge_confidence: 84,
      implements_issue: "yes",
      test_depth: "deep",
      missed_edge_cases: ["What if the 503 comes back after the retry budget is exhausted? Test asserts the giveup behavior but doesn't lock the error message format."],
      hidden_bugs: [],
      one_line_summary: "Tight retry logic with explicit backoff; tests cover the happy path and the 503-then-200 sequence.",
    },
  },
};

const failingChecks = {
  ...passingChecks,
  mutation_light: { name: "mutation_light", pass: false, hardGate: true, message: "Mutation-light: new tests pass even without the impl — they're not exercising the change.", detail: {} },
  critic: {
    ...passingChecks.critic,
    pass: false,
    message: "Critic: 42/100 — Test only asserts a string match against the original behavior; not exercising the new retry path.",
    detail: { ...passingChecks.critic.detail, merge_confidence: 42, one_line_summary: "Tests are shallow — they pass against either implementation." },
  },
};

const planBlob = (titleSlug: string, files: string[], tests: string[]) =>
  JSON.stringify({
    files_to_change: files.map((f) => ({ path: f, kind: "modify", why: `update ${titleSlug}` })),
    tests_to_add_or_update: tests.map((t) => ({ path: t, describes: `${titleSlug} behavior` })),
    user_visible_change: `Implements ${titleSlug}.`,
    edge_cases: [],
    complexity: "small",
    should_abort: false,
    abort_reason: null,
  }, null, 2);

const sampleDiff = `--- a/src/webhook.ts
+++ b/src/webhook.ts
@@ -38,11 +38,18 @@ export async function postEvent(event: Event) {
-async function postOnce(payload: unknown): Promise<Response> {
-  return fetch(WEBHOOK_URL, {
+const RETRYABLE = new Set([502, 503, 504]);
+
+async function postOnce(payload: unknown, attempt = 0): Promise<Response> {
+  const res = await fetch(WEBHOOK_URL, {
     method: "POST",
     headers: { "content-type": "application/json" },
     body: JSON.stringify(payload),
   });
+  if (RETRYABLE.has(res.status) && attempt < 3) {
+    const backoff = Math.min(2 ** attempt * 250, 4000);
+    await new Promise((r) => setTimeout(r, backoff));
+    return postOnce(payload, attempt + 1);
+  }
+  return res;
 }
`;

// --- Active runs (showing the live feed in action) ---

const r1 = insertRun({
  type: "implement",
  repo: "42nights/dataroom",
  issue_number: 187,
  issue_title: "Add idempotency key to /api/upload",
  issue_body: "Duplicate file uploads from a flaky network produce duplicate rows because /api/upload doesn't accept an idempotency-key header. Add support and dedupe on it before computing content hash.",
  branch_name: "bot/issue-187-3f9a2c",
  pr_number: null,
  pr_url: null,
  status: "iterating",
  attempts: 2,
  cost_usd: 1.43,
  started_at: now - 9 * min,
  finished_at: null,
});
insertEvent(r1, now - 9 * min, "run.created", { type: "implement" });
insertEvent(r1, now - 9 * min, "plan.started", {});
insertEvent(r1, now - 8.5 * min, "plan.completed", { complexity: "small", filesPlanned: 2, testsPlanned: 1 });
insertEvent(r1, now - 8 * min, "implement.started", {});
insertEvent(r1, now - 7 * min, "implement.tool_use", { tool: "Edit" });
insertEvent(r1, now - 7 * min, "implement.tool_use", { tool: "Edit" });
insertEvent(r1, now - 6.5 * min, "implement.tool_use", { tool: "Bash" });
insertEvent(r1, now - 6 * min, "implement.completed", {});
insertEvent(r1, now - 5.8 * min, "verification.started", { attempt: 1 });
insertEvent(r1, now - 5.5 * min, "verification.check_completed", { check: "typecheck", pass: true, message: "Typecheck passed." });
insertEvent(r1, now - 4 * min, "verification.check_completed", { check: "existing_tests", pass: true, message: "Test suite passed." });
insertEvent(r1, now - 3.5 * min, "verification.check_completed", { check: "mutation_light", pass: false, message: "new tests pass even without the impl" });
insertEvent(r1, now - 3 * min, "verification.completed", { attempt: 1, pass: false });
insertVerdict(r1, 1, false, failingChecks, "[HARD] mutation_light: new tests pass even without the impl — they're not exercising the change.");
insertEvent(r1, now - 2.5 * min, "iteration.started", { attempt: 2 });
insertEvent(r1, now - 2 * min, "implement.tool_use", { tool: "Edit" });
insertEvent(r1, now - 1 * min, "implement.tool_use", { tool: "Bash" });
insertArtifact(r1, "plan", planBlob("idempotency-key", ["app/api/upload/route.ts"], ["test/upload-idempotency.test.ts"]));
insertArtifact(r1, "diff", sampleDiff);

const r2 = insertRun({
  type: "review",
  repo: "42nights/dataroom",
  issue_number: null,
  issue_title: null,
  branch_name: null,
  pr_number: null,
  pr_url: null,
  status: "implementing",
  attempts: 1,
  cost_usd: 0.18,
  started_at: now - 2 * min,
  finished_at: null,
});
insertEvent(r2, now - 2 * min, "review.started", { repo: "42nights/dataroom" });
insertEvent(r2, now - 1.5 * min, "implement.tool_use", { tool: "Read" });
insertEvent(r2, now - 1 * min, "implement.tool_use", { tool: "Glob" });

// --- Completions (the "recent" feed) ---

function shippedRun(args: {
  hoursAgo: number;
  durationMin: number;
  issueNumber: number;
  prNumber: number;
  title: string;
  attempts: number;
  cost: number;
  needsReview?: boolean;
}) {
  const started = now - args.hoursAgo * hour;
  const finished = started + args.durationMin * min;
  const status = args.needsReview ? "needs-review" : "pr-opened";
  const id = insertRun({
    type: "implement",
    repo: "42nights/dataroom",
    issue_number: args.issueNumber,
    issue_title: args.title,
    issue_body: `(seeded fixture) ${args.title}`,
    branch_name: `bot/issue-${args.issueNumber}-${Math.random().toString(16).slice(2, 8)}`,
    pr_number: args.prNumber,
    pr_url: `https://github.com/42nights/dataroom/pull/${args.prNumber}`,
    status,
    attempts: args.attempts,
    cost_usd: args.cost,
    started_at: started,
    finished_at: finished,
  });
  insertEvent(id, started, "run.created", { type: "implement" });
  insertEvent(id, started + min, "plan.completed", { complexity: "small" });
  insertEvent(id, started + 2 * min, "implement.completed", {});
  insertEvent(id, started + 3 * min, "verification.completed", { attempt: 1, pass: !args.needsReview });
  if (args.attempts > 1) {
    insertEvent(id, started + 4 * min, "iteration.started", { attempt: 2 });
    insertEvent(id, started + 6 * min, "verification.completed", { attempt: 2, pass: !args.needsReview });
  }
  insertEvent(id, finished, args.needsReview ? "pr.needs_review" : "pr.opened", { number: args.prNumber, url: `https://github.com/42nights/dataroom/pull/${args.prNumber}` });
  insertEvent(id, finished, "run.finished", { outcome: args.needsReview ? "needs-review" : "pr-opened" });
  insertVerdict(id, args.attempts, !args.needsReview, args.needsReview ? failingChecks : passingChecks, args.needsReview ? "Critic merge confidence 42 < 60" : "All gates passed.");
  insertArtifact(id, "plan", planBlob(args.title.slice(0, 30), ["src/x.ts"], ["test/x.test.ts"]));
  if (id === r1 || id === r2) return;
  // Show a diff on a couple of them.
  if (args.issueNumber % 3 === 0) insertArtifact(id, "diff", sampleDiff);
}

shippedRun({ hoursAgo: 1.5, durationMin: 7, issueNumber: 185, prNumber: 211, title: "Bump max upload size to 50 MB", attempts: 1, cost: 0.41 });
shippedRun({ hoursAgo: 3, durationMin: 12, issueNumber: 184, prNumber: 210, title: "Fix race in citation preview sheet open/close", attempts: 2, cost: 0.83 });
shippedRun({ hoursAgo: 4.5, durationMin: 18, issueNumber: 183, prNumber: 209, title: "Add CSV parser fallback for quoted multiline cells", attempts: 1, cost: 0.62 });
shippedRun({ hoursAgo: 7, durationMin: 22, issueNumber: 182, prNumber: 208, title: "Webhook handler should reject stale (>5 min) timestamps", attempts: 3, cost: 1.71, needsReview: true });
shippedRun({ hoursAgo: 9, durationMin: 6, issueNumber: 181, prNumber: 207, title: "Empty-corpus answerability gate should be hit without LLM call", attempts: 1, cost: 0.29 });
shippedRun({ hoursAgo: 11, durationMin: 14, issueNumber: 180, prNumber: 206, title: "Use process.env.PORT default 3000 not hardcoded", attempts: 1, cost: 0.34 });
shippedRun({ hoursAgo: 14, durationMin: 24, issueNumber: 179, prNumber: 205, title: "Audit log: include W3C trace IDs from Linq SDK", attempts: 2, cost: 1.12 });

const r3 = insertRun({
  type: "implement",
  repo: "42nights/dataroom",
  issue_number: 178,
  issue_title: "Refactor entire embeddings pipeline to use a queue",
  issue_body: "Move all embedding writes through a background queue with retries, exponential backoff, and a circuit breaker. Should also support multiple embedding models.",
  branch_name: null,
  pr_number: null,
  pr_url: null,
  status: "abandoned",
  attempts: 0,
  cost_usd: 0.06,
  started_at: now - 16 * hour,
  finished_at: now - 16 * hour + 90 * 1000,
  error_message: "plan abort: too large for a bot — architectural change to introduce a queue, retry policy, circuit breaker, and multi-model support. Needs human review.",
});
insertEvent(r3, now - 16 * hour, "run.created", { type: "implement" });
insertEvent(r3, now - 16 * hour + 45 * 1000, "plan.aborted", { reason: "too large for a bot — needs human design" });
insertEvent(r3, now - 16 * hour + 90 * 1000, "run.finished", { outcome: "abandoned" });

// --- Reviewer history ---
const rv1 = insertRun({
  type: "review",
  repo: "42nights/dataroom",
  issue_number: null,
  issue_title: null,
  branch_name: null,
  pr_number: null,
  pr_url: null,
  status: "succeeded",
  attempts: 0,
  cost_usd: 0.21,
  started_at: now - 6 * hour,
  finished_at: now - 6 * hour + 4 * min,
});
insertEvent(rv1, now - 6 * hour, "review.started", { repo: "42nights/dataroom" });
insertEvent(rv1, now - 6 * hour + 2 * min, "review.proposed", { count: 5 });
insertEvent(rv1, now - 6 * hour + 3 * min, "review.deduped", { candidate: "Webhook missing timestamp check", existingNumber: 182, score: 0.81 });
insertEvent(rv1, now - 6 * hour + 3.5 * min, "review.opened_issue", { number: 191, url: "https://github.com/42nights/dataroom/issues/191" });
insertEvent(rv1, now - 6 * hour + 3.7 * min, "review.opened_issue", { number: 192, url: "https://github.com/42nights/dataroom/issues/192" });
insertEvent(rv1, now - 6 * hour + 3.9 * min, "review.opened_issue", { number: 193, url: "https://github.com/42nights/dataroom/issues/193" });
insertEvent(rv1, now - 6 * hour + 4 * min, "run.finished", { outcome: "succeeded" });

// --- Demo chat thread so the chat page isn't empty ---
const tid = Number(db.prepare(`INSERT INTO chat_threads (title, created_at, updated_at) VALUES (?, ?, ?)`)
  .run("what did you do in the past 24 hours?", now - 30 * min, now - 30 * min).lastInsertRowid);
db.prepare(`INSERT INTO chat_messages (thread_id, role, content, created_at) VALUES (?, 'user', ?, ?)`)
  .run(tid, "What did you do in the past 24 hours?", now - 30 * min);
db.prepare(`INSERT INTO chat_messages (thread_id, role, content, citations_json, created_at) VALUES (?, 'assistant', ?, ?, ?)`)
  .run(
    tid,
    `I worked on 9 issues:

- 6 PRs landed cleanly (one shot or a single iteration): #211, #210, #209, #207, #206, #205.
- 1 PR is awaiting your review (#208 — webhook timestamp rejection; mutation-light failed twice and the critic gave 42/100 on the third attempt).
- 1 issue I abandoned: #178 ("refactor entire embeddings pipeline to use a queue") — the planner said it was too architectural for a bot and asked for human design.
- 1 implementer run is in progress right now: #187 (idempotency key on upload), on its second iteration after the mutation-light check caught a shallow test.

The reviewer pass at 6h ago opened 3 new bot-found issues (#191, #192, #193) and skipped 1 it identified as a duplicate of #182.

Total spend last 24h: ~$7.16.`,
    JSON.stringify([
      { runId: 8, title: "Run #8 — implement", snippet: "Issue: #182 \"Webhook handler should reject stale...\"" },
      { runId: 9, title: "Run #9 — implement (abandoned)", snippet: "plan abort: too large for a bot..." },
      { runId: 10, title: "Run #10 — review", snippet: "Reviewer proposed 5, opened 3, deduped 1 (existing #182)." },
    ]),
    now - 29 * min,
  );

console.log("Seeded demo data:");
console.log("  runs:", db.prepare("SELECT COUNT(*) AS n FROM runs").get());
console.log("  events:", db.prepare("SELECT COUNT(*) AS n FROM events").get());
console.log("  verdicts:", db.prepare("SELECT COUNT(*) AS n FROM verdicts").get());
console.log("  artifacts:", db.prepare("SELECT COUNT(*) AS n FROM artifacts").get());
console.log("  chat_threads:", db.prepare("SELECT COUNT(*) AS n FROM chat_threads").get());
