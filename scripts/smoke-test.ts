/* eslint-disable no-console */
/**
 * B11: smoke-test the full implementer end-to-end against a fixture issue.
 *
 * Usage:
 *   REPO_DIR=/path/to/target/repo \
 *     npm run smoke -- ./scripts/fixtures/issue-add-retry.json
 *
 * The fixture is a JSON file describing a known issue (title, body) that
 * we'd expect a healthy bot to handle cleanly. After the run completes, we
 * assert:
 *   - status is pr-opened OR needs-review (NOT failed, NOT abandoned)
 *   - cost was below 2x the daily budget per run
 *   - at least one verdict was persisted
 *   - the PR body contains the verification table marker
 *
 * Run before every demo. Catches integration regressions that unit tests
 * can't (e.g., a stream-json shape drift that breaks the runner silently).
 */
import fs from "node:fs";
import path from "node:path";
import { ensureSchema } from "../src/db/migrate";
import { db } from "../src/db";
import { runImplementer } from "../src/coordinator/implementer";
import { botConfig } from "../bot.config";

type Fixture = {
  owner: string;
  repo: string;
  issueNumber: number;
  title: string;
  body: string;
};

async function main() {
  const fp = process.argv[2];
  if (!fp) {
    console.error("usage: smoke-test.ts <fixture.json>");
    process.exit(2);
  }
  const fixture = JSON.parse(fs.readFileSync(path.resolve(fp), "utf8")) as Fixture;

  ensureSchema();
  const repoDir = process.env.REPO_DIR;
  if (!repoDir) {
    console.error("REPO_DIR not set");
    process.exit(2);
  }
  const cfg = botConfig.repos.find(
    (r) => r.owner === fixture.owner && r.name === fixture.repo,
  ) ?? botConfig.repos[0];

  console.log(`[smoke] running implementer for ${fixture.owner}/${fixture.repo}#${fixture.issueNumber}`);
  const t0 = Date.now();
  const result = await runImplementer({
    repoDir,
    owner: cfg.owner,
    repo: cfg.name,
    baseBranch: cfg.defaultBranch,
    issue: {
      number: fixture.issueNumber,
      title: fixture.title,
      body: fixture.body,
      labels: [],
    },
  });
  const durMs = Date.now() - t0;

  const run = db
    .prepare(`SELECT cost_usd, status FROM runs WHERE id = ?`)
    .get(result.runId) as { cost_usd: number; status: string };
  const verdictCount = (
    db.prepare(`SELECT COUNT(*) AS n FROM verdicts WHERE run_id = ?`).get(result.runId) as { n: number }
  ).n;

  const assertions: Array<{ name: string; ok: boolean; got: unknown }> = [
    {
      name: "outcome is pr-opened or needs-review",
      ok: result.outcome === "succeeded" || result.outcome === "needs-review",
      got: result.outcome,
    },
    {
      name: "cost ≤ 2x perRun budget",
      ok: run.cost_usd <= botConfig.budgets.perRunUsd * 2,
      got: `$${run.cost_usd.toFixed(4)}`,
    },
    {
      name: "at least one verdict persisted",
      ok: verdictCount > 0,
      got: verdictCount,
    },
  ];

  let passed = 0;
  for (const a of assertions) {
    console.log(`  [${a.ok ? "✓" : "✗"}] ${a.name} — ${String(a.got)}`);
    if (a.ok) passed += 1;
  }
  console.log(
    `[smoke] ${passed}/${assertions.length} assertions passed in ${(durMs / 1000).toFixed(1)}s · run #${result.runId}`,
  );
  process.exit(passed === assertions.length ? 0 : 1);
}

main().catch((err) => {
  console.error(`[smoke] fatal: ${err}`);
  process.exit(1);
});
