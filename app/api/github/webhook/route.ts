import { NextRequest } from "next/server";
import { ensureSchema } from "@/src/db/migrate";
import { verifyGitHubSignature, type GitHubEvent } from "@/src/github/webhook";
import { log } from "@/src/shared/logger";
import { db } from "@/src/db";
import { requestDispatch } from "@/src/coordinator/dispatch";

export const runtime = "nodejs";

/**
 * Handles GitHub webhooks. Verifies HMAC on the raw body, persists every
 * delivery as an event row (for audit + replay), then routes:
 *
 *  - issues.opened / issues.labeled with our request label
 *      → flip the implementer dispatch signal so the coordinator polls
 *        within 2s instead of waiting up to 60s for the next interval tick.
 *  - pull_request.closed with merged:true
 *      → look up the run by pr_number, mark succeeded, schedule worktree
 *        cleanup. (Spec §18.4 — A9 in the review.)
 *  - everything else → log + 200.
 *
 * Fast-acks. Heavy work happens in the coordinator process.
 */
export async function POST(req: NextRequest) {
  ensureSchema();
  const raw = await req.text();
  const secret = process.env.GITHUB_WEBHOOK_SECRET;
  if (!secret) {
    return new Response("GITHUB_WEBHOOK_SECRET not set", { status: 500 });
  }
  const signature = req.headers.get("x-hub-signature-256") ?? "";
  const eventName = req.headers.get("x-github-event") ?? "";
  const deliveryId = req.headers.get("x-github-delivery") ?? "";

  if (!verifyGitHubSignature(raw, signature, secret)) {
    log.warn("webhook", `signature reject (event=${eventName})`);
    return new Response("forbidden", { status: 403 });
  }

  let payload: GitHubEvent;
  try {
    payload = JSON.parse(raw);
  } catch {
    return new Response("bad json", { status: 400 });
  }

  // Persist a sliver so we have an audit trail (run_id=0 = system events).
  db.prepare(
    `INSERT INTO runs (id, type, repo, status, started_at)
     SELECT 0, 'system', '_system', 'succeeded', ?
     WHERE NOT EXISTS (SELECT 1 FROM runs WHERE id = 0)`,
  ).run(Date.now());
  db.prepare(
    `INSERT INTO events (run_id, ts, kind, payload_json)
     VALUES (0, ?, ?, ?)`,
  ).run(
    Date.now(),
    `gh.${eventName}.${payload.action ?? "_"}`,
    JSON.stringify({ deliveryId, payload }),
  );

  // A3/B5: ask the coordinator to poll NOW rather than waiting up to 60s.
  if (
    eventName === "issues" &&
    (payload.action === "labeled" || payload.action === "opened")
  ) {
    requestDispatch("implementer");
    log.info("webhook", `→ implementer dispatch (action=${payload.action})`);
  }

  // A9: a PR merge closes the loop. Mark the run, leave worktree cleanup to
  // the coordinator's reap cron so we don't block the webhook.
  if (
    eventName === "pull_request" &&
    payload.action === "closed" &&
    payload.pull_request?.merged === true
  ) {
    const prNumber = payload.pull_request.number;
    const row = db
      .prepare(
        `SELECT id, worktree_path FROM runs
           WHERE pr_number = ? AND status IN ('pr-opened','needs-review')
           ORDER BY started_at DESC LIMIT 1`,
      )
      .get(prNumber) as { id: number; worktree_path: string | null } | undefined;
    if (row) {
      db.prepare(
        `UPDATE runs SET status='succeeded', finished_at=? WHERE id=?`,
      ).run(Date.now(), row.id);
      db.prepare(
        `INSERT INTO events (run_id, ts, kind, payload_json) VALUES (?, ?, 'pr.merged', ?)`,
      ).run(row.id, Date.now(), JSON.stringify({ prNumber }));
      log.info("webhook", `PR #${prNumber} merged → run #${row.id} succeeded`);
    } else {
      log.info("webhook", `PR #${prNumber} merged but no matching run row`);
    }
  }

  return new Response("ok", { status: 200 });
}
