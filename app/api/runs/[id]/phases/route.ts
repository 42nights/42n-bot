import { NextRequest, NextResponse } from "next/server";
import { listPhaseCostsByRun, type PhaseCostRow } from "@/src/db/ops/phaseCosts";

export const runtime = "nodejs";

export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  if (!id) return NextResponse.json({ error: "bad id" }, { status: 400 });

  const phases = await listPhaseCostsByRun(id);

  const rollup = new Map<
    string,
    {
      phase: string;
      totalCostUsd: number;
      totalMs: number;
      attempts: number;
      allOk: boolean;
    }
  >();
  for (const p of phases) {
    const cur = rollup.get(p.phase) ?? {
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
