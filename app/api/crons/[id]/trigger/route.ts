import { NextRequest, NextResponse } from "next/server";
import { getCron } from "@/src/cron/store";
import { forceDueCron } from "@/src/db/ops/crons";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function POST(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
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
