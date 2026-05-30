import { NextRequest, NextResponse } from "next/server";
import { ensureSchema } from "@/src/db/migrate";
import { getCron, recordCronRun } from "@/src/cron/store";

export const runtime = "nodejs";
export const maxDuration = 300;

/**
 * Fire a cron right now, regardless of its schedule. Convenient for testing
 * a new cron from the UI without waiting for its next tick. Uses the same
 * code path as the scheduler.
 */
export async function POST(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  ensureSchema();
  const { id } = await ctx.params;
  const cron = getCron(Number(id));
  if (!cron) return NextResponse.json({ error: "not found" }, { status: 404 });

  // Lazy-import the scheduler to keep this route's bundle small.
  const { tickScheduler } = await import("@/src/cron/scheduler");
  // The scheduler fires anything whose next_run_at is <= now. Force-due the
  // selected cron, then tick.
  const { db } = await import("@/src/db");
  db.prepare(`UPDATE crons SET next_run_at = ? WHERE id = ?`).run(
    Date.now() - 1000,
    cron.id,
  );
  try {
    const result = await tickScheduler();
    return NextResponse.json({ ok: true, fired: result.fired });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    recordCronRun(cron.id, { ok: false, message });
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
