import { NextRequest, NextResponse } from "next/server";
import { ensureSchema } from "@/src/db/migrate";
import { db } from "@/src/db";

export const runtime = "nodejs";

type PhaseCostRow = {
  id: number;
  run_id: number;
  phase: string;
  attempt: number;
  cost_usd: number;
  duration_ms: number;
  ok: number;
  created_at: number;
};

/**
 * Per-phase cost + duration breakdown for a single run. Powers the
 * "where did the money go" surface on the session-detail page.
 */
export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  ensureSchema();
  const { id } = await ctx.params;
  const n = Number(id);
  if (!Number.isFinite(n)) {
    return NextResponse.json({ error: "bad id" }, { status: 400 });
  }
  const phases = db
    .prepare(
      `SELECT * FROM phase_costs WHERE run_id = ? ORDER BY created_at ASC`,
    )
    .all(n) as PhaseCostRow[];

  // Roll up per phase (sum across attempts) for the headline numbers.
  const rollup = new Map<
    string,
    { phase: string; totalCostUsd: number; totalMs: number; attempts: number; allOk: boolean }
  >();
  for (const p of phases) {
    const cur =
      rollup.get(p.phase) ?? {
        phase: p.phase,
        totalCostUsd: 0,
        totalMs: 0,
        attempts: 0,
        allOk: true,
      };
    cur.totalCostUsd += p.cost_usd;
    cur.totalMs += p.duration_ms;
    cur.attempts += 1;
    if (!p.ok) cur.allOk = false;
    rollup.set(p.phase, cur);
  }

  return NextResponse.json({
    phases,
    rollup: Array.from(rollup.values()),
  });
}
