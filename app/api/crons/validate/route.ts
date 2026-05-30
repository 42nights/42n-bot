import { NextRequest, NextResponse } from "next/server";
import { validateSchedule } from "@/src/cron/store";

export const runtime = "nodejs";

/**
 * QA1: pure validation endpoint. The cron-create modal used to validate by
 * POSTing a real cron then DELETE-ing it — which leaked rows whenever the
 * tab closed mid-validation. This route is side-effect-free.
 */
export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as { schedule?: string };
  const schedule = (body.schedule ?? "").trim();
  if (!schedule) {
    return NextResponse.json({ ok: false, error: "empty schedule" });
  }
  const v = validateSchedule(schedule);
  return NextResponse.json(v);
}
