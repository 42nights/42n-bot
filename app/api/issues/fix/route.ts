import { NextRequest, NextResponse } from "next/server";
import { ensureSchema } from "@/src/db/migrate";
import { addLabel } from "@/src/github/client";
import { botConfig } from "@/bot.config";
import { requestDispatch } from "@/src/coordinator/dispatch";
import { requireAdmin } from "@/src/shared/auth";
import { log } from "@/src/shared/logger";

export const runtime = "nodejs";

/**
 * Fix-it button. Labels the issue `bot-please` and pokes the coordinator's
 * dispatch channel so it picks the issue up on its next 2s tick instead of
 * waiting for the 60s polling cycle.
 *
 * Idempotent: re-labelling is a no-op on GitHub's side, and we don't create
 * a run row here — the coordinator owns that lifecycle.
 */
export async function POST(req: NextRequest) {
  const denied = requireAdmin(req);
  if (denied) return denied;
  ensureSchema();
  const body = (await req.json().catch(() => ({}))) as {
    owner?: string;
    repo?: string;
    issue_number?: number;
  };
  if (!body.owner || !body.repo || !body.issue_number) {
    return NextResponse.json(
      { error: "owner + repo + issue_number required" },
      { status: 400 },
    );
  }
  try {
    await addLabel({
      owner: body.owner,
      repo: body.repo,
      issue_number: body.issue_number,
      label: botConfig.labels.request,
    });
    requestDispatch("implementer");
    log.info(
      "issues",
      `fix-it: labeled ${body.owner}/${body.repo}#${body.issue_number} → coordinator dispatched`,
    );
    return NextResponse.json({ ok: true });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const status = (err as { status?: number }).status ?? 500;
    return NextResponse.json({ error: msg }, { status });
  }
}
