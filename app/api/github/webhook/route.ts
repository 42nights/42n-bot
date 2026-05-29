import { NextRequest } from "next/server";
import { ensureSchema } from "@/src/db/migrate";
import { verifyGitHubSignature, type GitHubEvent } from "@/src/github/webhook";
import { log } from "@/src/shared/logger";
import { db } from "@/src/db";

export const runtime = "nodejs";

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

  // Fast-ack — coordinator daemon picks up the work via polling.
  return new Response("ok", { status: 200 });
}
