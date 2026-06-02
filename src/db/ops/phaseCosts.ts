import { convex, api } from "../convex-client";
import type { Id } from "../../../convex/_generated/dataModel";

export type PhaseCostRow = {
  _id: string;
  run_id: string;
  phase: string;
  attempt: number;
  cost_usd: number;
  duration_ms: number;
  ok: number;
  created_at: number;
};

export async function insertPhaseCost(args: {
  run_id: string;
  phase: string;
  attempt: number;
  cost_usd: number;
  duration_ms: number;
  ok: number;
}): Promise<void> {
  await convex.mutation(api.phaseCosts.insert, {
    run_id: args.run_id as Id<"runs">,
    phase: args.phase,
    attempt: args.attempt,
    cost_usd: args.cost_usd,
    duration_ms: args.duration_ms,
    ok: args.ok,
    created_at: Date.now(),
  });
}

export async function listPhaseCostsByRun(
  run_id: string,
): Promise<PhaseCostRow[]> {
  const rows = await convex.query(api.phaseCosts.listByRun, {
    run_id: run_id as Id<"runs">,
  });
  return rows as PhaseCostRow[];
}
