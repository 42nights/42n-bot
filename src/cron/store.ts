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

/**
 * Record that a cron fired. Accepts the full row (avoids a re-read + race
 * where the row could be deleted between scheduler-read and history-insert)
 * OR an id-and-schedule pair for the manual-trigger path.
 *
 * Wrapped in a transaction so we never advance `next_run_at` without also
 * inserting the cron_runs history row — the bug otherwise was an "invisible
 * fire" where the schedule moved forward but no history was recorded.
 */
export function markCronFired(
  cronOrId: number | { id: number; schedule: string },
  result: {
    ok: boolean;
    message: string;
    runId?: number;
  },
): void {
  let id: number;
  let schedule: string | null;
  if (typeof cronOrId === "number") {
    const row = getCron(cronOrId);
    if (!row) return;
    id = row.id;
    schedule = row.schedule;
  } else {
    id = cronOrId.id;
    schedule = cronOrId.schedule;
  }
  const now = Date.now();
  const next = nextFireAt(schedule, now);
  // QA2: if the cron row was deleted between dueCrons() and now, the UPDATE
  // hits 0 rows (silent) but the INSERT will FK-violate. Without the early
  // existence check, the transaction would roll back the schedule advance
  // and the cron would be "due forever" — infinite retry loop spamming logs
  // at one error per tick. Skip cleanly when the row is gone.
  const stillExists = db
    .prepare(`SELECT 1 FROM crons WHERE id = ?`)
    .get(id) as { 1: number } | undefined;
  if (!stillExists) return;
  const tx = db.transaction(() => {
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
  });
  try {
    tx();
  } catch (err) {
    // Last-ditch: if a constraint violation slipped through (e.g., the cron
    // was deleted between the existence check and the transaction), log and
    // skip rather than re-throwing. The scheduler's per-cron catch would
    // already swallow this, but doing it here keeps the schedule advance
    // moving forward instead of getting stuck.
    const msg = err instanceof Error ? err.message : String(err);
    if (/FOREIGN KEY/i.test(msg) || /no such row/i.test(msg)) return;
    throw err;
  }
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
