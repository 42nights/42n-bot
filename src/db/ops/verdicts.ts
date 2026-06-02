import { convex, api } from "../convex-client";
import type { Id } from "../../../convex/_generated/dataModel";

export type VerdictRow = {
  _id: string;
  run_id: string;
  attempt: number;
  pass: number;
  checks_json: string;
  failure_summary?: string;
  created_at: number;
};

export async function insertVerdict(args: {
  run_id: string;
  attempt: number;
  pass: number;
  checks_json: string;
  failure_summary?: string | null;
}): Promise<void> {
  await convex.mutation(api.verdicts.insert, {
    run_id: args.run_id as Id<"runs">,
    attempt: args.attempt,
    pass: args.pass,
    checks_json: args.checks_json,
    failure_summary: args.failure_summary ?? undefined,
    created_at: Date.now(),
  });
}

export async function listVerdictsByRun(run_id: string): Promise<VerdictRow[]> {
  const rows = await convex.query(api.verdicts.listByRun, {
    run_id: run_id as Id<"runs">,
  });
  return rows as VerdictRow[];
}
