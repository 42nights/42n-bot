import { insertPhaseCost } from "../../db/ops/phaseCosts";
import type { PhaseName } from "./types";

export function recordPhaseCost(args: {
  runId: string;
  phase: PhaseName;
  attempt?: number;
  costUsd: number;
  durationMs: number;
  ok: boolean;
}): void {
  insertPhaseCost({
    run_id: args.runId,
    phase: args.phase,
    attempt: args.attempt ?? 1,
    cost_usd: args.costUsd,
    duration_ms: args.durationMs,
    ok: args.ok ? 1 : 0,
  }).catch((err) => {
    // eslint-disable-next-line no-console
    console.error(`recordPhaseCost failed:`, err);
  });
}
