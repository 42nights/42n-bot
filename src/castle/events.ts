import { tenant } from "../../lib/tenant";

const CASTLE_API_URL = process.env.CASTLE_API_URL ?? null;
const CASTLE_DEPLOYMENT_ID = process.env.CASTLE_DEPLOYMENT_ID ?? null;
const CASTLE_WEBHOOK_SECRET = process.env.CASTLE_WEBHOOK_SECRET ?? null;

export type CastleEvent =
  | { kind: "session_started"; session_id: string; issue_url: string; created_at: string }
  | { kind: "pr_opened"; session_id: string; pr_url: string; outcome: "passing" | "needs_review" }
  | { kind: "verification_failed"; session_id: string; phase: string; reason: string }
  | { kind: "session_ended"; session_id: string; status: "succeeded" | "failed" | "canceled" };

async function postEvent(body: object): Promise<void> {
  if (!CASTLE_API_URL || !CASTLE_DEPLOYMENT_ID) return;

  const url = `${CASTLE_API_URL}/deployments/${CASTLE_DEPLOYMENT_ID}/events`;
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (CASTLE_WEBHOOK_SECRET) headers["x-castle-secret"] = CASTLE_WEBHOOK_SECRET;

  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await fetch(url, {
        method: "POST",
        headers,
        body: JSON.stringify(body),
      });
      if (res.ok) return;
      if (attempt === 0) continue;
    } catch {
      if (attempt === 0) continue;
    }
  }
}

export async function emitDeploymentEvent(event: CastleEvent): Promise<void> {
  try {
    await postEvent(event);
  } catch {
    // Castle outage must never break Otis
  }
}

export function startHeartbeat({ intervalMs = 60_000 }: { intervalMs?: number } = {}): () => void {
  if (!CASTLE_API_URL || !CASTLE_DEPLOYMENT_ID) return () => {};

  const timer = setInterval(() => {
    postEvent({
      kind: "heartbeat",
      tenant: tenant.slug,
      version: process.env.npm_package_version ?? "unknown",
    }).catch(() => {});
  }, intervalMs);

  return () => clearInterval(timer);
}
