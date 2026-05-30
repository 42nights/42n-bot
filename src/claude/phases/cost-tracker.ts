import { db } from "../../db";
import type { PhaseName } from "./types";

/**
 * Persist a phase's cost + duration + outcome to the `phase_costs` table.
 * Every phase wrapper calls this on completion (success or failure) so we
 * can later answer "which phase is the expensive one" on the dashboard.
 */
export function recordPhaseCost(args: {
  runId: number;
  phase: PhaseName;
  attempt?: number;
  costUsd: number;
  durationMs: number;
  ok: boolean;
}): void {
  db.prepare(
    `INSERT INTO phase_costs (run_id, phase, attempt, cost_usd, duration_ms, ok, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    args.runId,
    args.phase,
    args.attempt ?? 1,
    args.costUsd,
    args.durationMs,
    args.ok ? 1 : 0,
    Date.now(),
  );
}
