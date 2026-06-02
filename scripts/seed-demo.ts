/* eslint-disable no-console */
/**
 * Seed demo data into the Convex deployment.
 * Rewritten for the Convex persistence layer.
 */
import { createRun } from "../src/db/ops/runs";
import { insertEvent } from "../src/db/ops/events";
import { insertVerdict } from "../src/db/ops/verdicts";
import { insertArtifact } from "../src/db/ops/artifacts";
import { upsertRepo } from "../src/db/ops/repos";

const now = Date.now();
const min = 60 * 1000;
const hour = 60 * min;

async function seed() {
  // The repo the demo runs belong to, so the repos view isn't empty.
  await upsertRepo({
    owner: "demo-org",
    name: "demo-repo",
    default_branch: "main",
    enabled: 1,
    repo_url: "https://github.com/demo-org/demo-repo",
    description: "Demo repository wired to Otis for issue→PR runs.",
    created_at: now - 30 * 24 * hour,
    updated_at: now - hour,
  });

  // Seed a succeeded implement run.
  const runId1 = await createRun({
    type: "implement",
    repo: "demo-org/demo-repo",
    issue_number: 42,
    issue_title: "Fix retry logic in API client",
    issue_body: "The API client doesn't retry on 503 responses.",
    status: "succeeded",
    started_at: now - 2 * hour,
  });
  await insertEvent(runId1, "run.created", { type: "implement", issue: 42 });
  await insertEvent(runId1, "plan.started", {});
  await insertEvent(runId1, "implement.started", {});
  await insertEvent(runId1, "pr.opened", { number: 101, url: "https://github.com/demo-org/demo-repo/pull/101" });
  await insertEvent(runId1, "run.finished", { outcome: "succeeded" });
  await insertVerdict({
    run_id: runId1,
    attempt: 1,
    pass: 1,
    checks_json: JSON.stringify({ typecheck: { pass: true }, existing_tests: { pass: true } }),
    failure_summary: "All gates passed.",
  });
  await insertArtifact(runId1, "plan", JSON.stringify({ user_visible_change: "Add retry on 503", complexity: "small", files_to_change: [{ path: "src/api/client.ts", kind: "modify", why: "Add retry" }], tests_to_add_or_update: [], edge_cases: [], should_abort: false, abort_reason: null }));

  // Seed a failed run.
  const runId2 = await createRun({
    type: "implement",
    repo: "demo-org/demo-repo",
    issue_number: 43,
    issue_title: "Add dark mode toggle",
    status: "failed",
    started_at: now - hour,
  });
  await insertEvent(runId2, "run.created", { type: "implement", issue: 43 });
  await insertEvent(runId2, "run.finished", { outcome: "failed" });

  console.log(`Seeded demo data: run ${runId1} (succeeded), run ${runId2} (failed)`);
}

seed().catch((err) => {
  console.error("seed-demo failed:", err);
  process.exit(1);
});
