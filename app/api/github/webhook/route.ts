import { NextRequest } from "next/server";
import { verifyGitHubSignature, type GitHubEvent } from "@/src/github/webhook";
import { readWebhookSecret } from "@/src/github/app";
import { log } from "@/src/shared/logger";
import { requestDispatch } from "@/src/coordinator/dispatch";
import { claimWebhookDelivery } from "@/src/db/ops/webhookDeliveries";
import { ensureSystemRun } from "@/src/db/ops/runs";
import { insertEvent } from "@/src/db/ops/events";
import { getRunByPrNumber, patchRun } from "@/src/db/ops/runs";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const raw = await req.text();
  const secret = await readWebhookSecret();
  if (!secret) {
    return new Response("no webhook secret configured", { status: 500 });
  }
  const signature = req.headers.get("x-hub-signature-256") ?? "";
  const eventName = req.headers.get("x-github-event") ?? "";
  const deliveryId = req.headers.get("x-github-delivery") ?? "";

  if (!verifyGitHubSignature(raw, signature, secret)) {
    log.warn("webhook", `signature reject (event=${eventName})`);
    return new Response("forbidden", { status: 403 });
  }

  if (deliveryId) {
    const claimed = await claimWebhookDelivery(deliveryId, eventName);
    if (!claimed) {
      log.info("webhook", `duplicate delivery ${deliveryId} — ignoring`);
      return new Response("duplicate", { status: 200 });
    }
  }

  let payload: GitHubEvent;
  try {
    payload = JSON.parse(raw);
  } catch {
    return new Response("bad json", { status: 400 });
  }

  // Persist an audit event on the system run.
  const systemRunId = await ensureSystemRun(Date.now());
  await insertEvent(
    systemRunId,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    `gh.${eventName}.${(payload as any).action ?? "_"}` as any,
    { deliveryId, payload },
  );

  if (
    eventName === "issues" &&
    (payload.action === "labeled" || payload.action === "opened")
  ) {
    requestDispatch("implementer");
    log.info("webhook", `→ implementer dispatch (action=${payload.action})`);
  }

  if (
    eventName === "pull_request" &&
    payload.action === "closed" &&
    payload.pull_request?.merged === true
  ) {
    const prNumber = payload.pull_request.number;
    const row = await getRunByPrNumber(prNumber);
    if (
      row &&
      (row.status === "pr-opened" || row.status === "needs-review")
    ) {
      await patchRun(row._id, {
        status: "succeeded",
        finished_at: Date.now(),
      });
      await insertEvent(row._id, "pr.merged", { prNumber });
      log.info("webhook", `PR #${prNumber} merged → run #${row._id} succeeded`);
    } else {
      log.info("webhook", `PR #${prNumber} merged but no matching run row`);
    }
  }

  return new Response("ok", { status: 200 });
}
