import { NextRequest, NextResponse } from "next/server";
import { getCron } from "@/src/cron/store";
import { forceDueCron } from "@/src/db/ops/crons";
import { requireAdmin } from "@/src/shared/auth";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const denied = requireAdmin(req);
  if (denied) return denied;
  const { id } = await ctx.params;
  const cron = await getCron(id);
  if (!cron) return NextResponse.json({ error: "not found" }, { status: 404 });

  const { tickScheduler } = await import("@/src/cron/scheduler");
  await forceDueCron(cron._id);
  try {
    const result = await tickScheduler();
    return NextResponse.json({ ok: true, fired: result.fired });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
