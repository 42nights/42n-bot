import { convex, api } from "../convex-client";
import type { Id } from "../../../convex/_generated/dataModel";

export type CronRow = {
  _id: string;
  name: string;
  schedule: string;
  action: string;
  payload_json: string;
  repo?: string;
  enabled: number;
  last_run_at?: number;
  next_run_at?: number;
  created_at: number;
  updated_at: number;
};

export type CronRunRow = {
  _id: string;
  cron_id: string;
  started_at: number;
  finished_at?: number;
  ok: number;
  message?: string;
  run_id?: string;
};

export async function listCrons(): Promise<CronRow[]> {
  const rows = await convex.query(api.cronStore.list, {});
  return rows as CronRow[];
}

export async function getCron(id: string): Promise<CronRow | null> {
  const row = await convex.query(api.cronStore.getById, {
    id: id as Id<"crons">,
  });
  return (row as CronRow | null) ?? null;
}

export async function createCronRow(args: {
  name: string;
  schedule: string;
  action: string;
  payload_json: string;
  repo?: string | null;
  enabled: number;
  next_run_at?: number | null;
  created_at: number;
  updated_at: number;
}): Promise<string> {
  return convex.mutation(api.cronStore.create, {
    name: args.name,
    schedule: args.schedule,
    action: args.action,
    payload_json: args.payload_json,
    repo: args.repo ?? undefined,
    enabled: args.enabled,
    next_run_at: args.next_run_at ?? undefined,
    created_at: args.created_at,
    updated_at: args.updated_at,
  }) as Promise<string>;
}

export async function updateCronRow(
  id: string,
  patch: Record<string, unknown>,
): Promise<CronRow | null> {
  const row = await convex.mutation(api.cronStore.update, {
    id: id as Id<"crons">,
    patchJson: JSON.stringify(patch),
  });
  return (row as CronRow | null) ?? null;
}

export async function deleteCronRow(id: string): Promise<boolean> {
  return convex.mutation(api.cronStore.remove, { id: id as Id<"crons"> });
}

export async function getDueCrons(now: number, limit?: number): Promise<CronRow[]> {
  const rows = await convex.query(api.cronStore.getDue, { now, limit });
  return rows as CronRow[];
}

export async function claimDueCron(
  id: string,
  expected_next_run_at: number | undefined,
  new_next_run_at: number | undefined,
  now: number,
): Promise<boolean> {
  return convex.mutation(api.cronStore.claimDue, {
    id: id as Id<"crons">,
    expected_next_run_at,
    new_next_run_at,
    now,
  });
}

export async function recordCronRunRow(args: {
  cron_id: string;
  ok: boolean;
  message: string;
  run_id?: string | null;
}): Promise<void> {
  const now = Date.now();
  await convex.mutation(api.cronStore.recordCronRun, {
    cron_id: args.cron_id as Id<"crons">,
    started_at: now,
    finished_at: now,
    ok: args.ok ? 1 : 0,
    message: args.message,
    run_id: args.run_id ? (args.run_id as Id<"runs">) : undefined,
  });
}

export async function listCronRunRows(
  cron_id: string,
  limit?: number,
): Promise<CronRunRow[]> {
  const rows = await convex.query(api.cronStore.listCronRuns, {
    cron_id: cron_id as Id<"crons">,
    limit,
  });
  return rows as CronRunRow[];
}

export async function pruneCronRunRows(cutoff: number): Promise<number> {
  return convex.mutation(api.cronStore.pruneCronRuns, { cutoff });
}

// Force a cron's next_run_at to now-1 (so the scheduler sees it as due).
export async function forceDueCron(id: string): Promise<void> {
  await convex.mutation(api.cronStore.update, {
    id: id as Id<"crons">,
    patchJson: JSON.stringify({ next_run_at: Date.now() - 1000 }),
  });
}
