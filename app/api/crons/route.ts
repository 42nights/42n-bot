import { NextRequest, NextResponse } from "next/server";
import { createCron, listCrons, type CronAction } from "@/src/cron/store";
import { requireAdmin } from "@/src/shared/auth";
import { withId, withIds } from "@/src/db/serialize";

export const runtime = "nodejs";

export async function GET() {
  return NextResponse.json({ crons: withIds(await listCrons()) });
}

const ACTIONS: CronAction[] = ["reviewer", "fix_issue", "send_otis"];

export async function POST(req: NextRequest) {
  const denied = requireAdmin(req);
  if (denied) return denied;
  const body = (await req.json().catch(() => ({}))) as {
    name?: string;
    schedule?: string;
    action?: string;
    payload?: Record<string, unknown>;
    repo?: string | null;
    enabled?: boolean;
  };
  if (!body.name || !body.schedule || !body.action) {
    return NextResponse.json(
      { error: "name, schedule, and action are required" },
      { status: 400 },
    );
  }
  if (!ACTIONS.includes(body.action as CronAction)) {
    return NextResponse.json(
      { error: `unknown action: ${body.action}` },
      { status: 400 },
    );
  }
  try {
    const cron = await createCron({
      name: body.name,
      schedule: body.schedule,
      action: body.action as CronAction,
      payload: body.payload ?? {},
      repo: body.repo ?? null,
      enabled: body.enabled !== false,
    });
    return NextResponse.json({ ok: true, cron: withId(cron) });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
