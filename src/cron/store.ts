import { CronExpressionParser } from "cron-parser";
import { db } from "../db";

export type CronAction = "reviewer" | "fix_issue" | "send_otis";

export type CronRow = {
  id: number;
  name: string;
  schedule: string;
  action: CronAction;
  payload_json: string;
  repo: string | null;
  enabled: number;
  last_run_at: number | null;
  next_run_at: number | null;
  created_at: number;
  updated_at: number;
};

export type CronRunRow = {
  id: number;
  cron_id: number;
  started_at: number;
  finished_at: number | null;
  ok: number;
  message: string | null;
  run_id: number | null;
};

/**
 * Compute the next fire time for a cron expression given a baseline (default
 * = now). Returns null if the expression is unparseable so callers can flag
 * the row as broken instead of crashing the scheduler loop.
 */
export function nextFireAt(schedule: string, since = Date.now()): number | null {
  try {
    const it = CronExpressionParser.parse(schedule, { currentDate: new Date(since) });
    return it.next().getTime();
  } catch {
    return null;
  }
}

export function validateSchedule(schedule: string): {
  ok: boolean;
  error?: string;
  nextRun?: number;
} {
  try {
    const it = CronExpressionParser.parse(schedule);
    return { ok: true, nextRun: it.next().getTime() };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}

export function listCrons(): CronRow[] {
  return db
    .prepare(`SELECT * FROM crons ORDER BY enabled DESC, next_run_at ASC`)
    .all() as CronRow[];
}

export function getCron(id: number): CronRow | null {
  return (
    (db.prepare(`SELECT * FROM crons WHERE id = ?`).get(id) as CronRow) ?? null
  );
}

export function createCron(args: {
  name: string;
  schedule: string;
  action: CronAction;
  payload: Record<string, unknown>;
  repo: string | null;
  enabled: boolean;
}): CronRow {
  const v = validateSchedule(args.schedule);
  if (!v.ok)
    throw new Error(`Bad cron schedule "${args.schedule}": ${v.error}`);
  const now = Date.now();
  const info = db
    .prepare(
      `INSERT INTO crons (name, schedule, action, payload_json, repo, enabled,
                          next_run_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      args.name,
      args.schedule,
      args.action,
      JSON.stringify(args.payload),
      args.repo,
      args.enabled ? 1 : 0,
      v.nextRun ?? null,
      now,
      now,
    );
  return getCron(Number(info.lastInsertRowid))!;
}

export function updateCron(
  id: number,
  patch: Partial<{
    name: string;
    schedule: string;
    action: CronAction;
    payload: Record<string, unknown>;
    repo: string | null;
    enabled: boolean;
  }>,
): CronRow | null {
  const existing = getCron(id);
  if (!existing) return null;

  // Re-compute next_run_at whenever the schedule changes.
  let nextRunAt = existing.next_run_at;
  let schedule = existing.schedule;
  if (patch.schedule !== undefined && patch.schedule !== existing.schedule) {
    const v = validateSchedule(patch.schedule);
    if (!v.ok)
      throw new Error(`Bad cron schedule "${patch.schedule}": ${v.error}`);
    schedule = patch.schedule;
    nextRunAt = v.nextRun ?? null;
  }

  db.prepare(
    `UPDATE crons SET
       name = COALESCE(?, name),
       schedule = ?,
       action = COALESCE(?, action),
       payload_json = COALESCE(?, payload_json),
       repo = COALESCE(?, repo),
       enabled = COALESCE(?, enabled),
       next_run_at = ?,
       updated_at = ?
     WHERE id = ?`,
  ).run(
    patch.name ?? null,
    schedule,
    patch.action ?? null,
    patch.payload ? JSON.stringify(patch.payload) : null,
    patch.repo !== undefined ? patch.repo : null,
    patch.enabled !== undefined ? (patch.enabled ? 1 : 0) : null,
    nextRunAt,
    Date.now(),
    id,
  );
  return getCron(id);
}

export function deleteCron(id: number): boolean {
  const r = db.prepare(`DELETE FROM crons WHERE id = ?`).run(id);
  return r.changes > 0;
}

/**
 * Crons that are due to fire (enabled + next_run_at <= now). Returns up to
 * `limit` so a giant backlog doesn't block the tick.
 */
export function dueCrons(limit = 10): CronRow[] {
  return db
    .prepare(
      `SELECT * FROM crons
         WHERE enabled = 1
           AND next_run_at IS NOT NULL
           AND next_run_at <= ?
         ORDER BY next_run_at ASC
         LIMIT ?`,
    )
    .all(Date.now(), limit) as CronRow[];
}

export function markCronFired(
  id: number,
  result: {
    ok: boolean;
    message: string;
    runId?: number;
  },
): void {
  const cron = getCron(id);
  if (!cron) return;
  const now = Date.now();
  const next = nextFireAt(cron.schedule, now);
  db.prepare(
    `UPDATE crons SET last_run_at = ?, next_run_at = ?, updated_at = ? WHERE id = ?`,
  ).run(now, next, now, id);
  db.prepare(
    `INSERT INTO cron_runs (cron_id, started_at, finished_at, ok, message, run_id)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    now,
    now,
    result.ok ? 1 : 0,
    result.message,
    result.runId ?? null,
  );
}

export function listCronRuns(cronId: number, limit = 50): CronRunRow[] {
  return db
    .prepare(
      `SELECT * FROM cron_runs
         WHERE cron_id = ?
         ORDER BY started_at DESC LIMIT ?`,
    )
    .all(cronId, limit) as CronRunRow[];
}
