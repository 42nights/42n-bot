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

/**
 * QA3 (R3 finding 8): bound payloads so a 10MB body can't be persisted into
 * the payload_json TEXT column (resource exhaustion). Validates per-action
 * shape too — send_otis needs a sane title/body.
 */
const MAX_PAYLOAD_BYTES = 16 * 1024; // 16KB — generous for an issue body
const MAX_TITLE_LEN = 256;
const MAX_BODY_LEN = 8 * 1024;

export function validatePayload(
  action: CronAction,
  payload: Record<string, unknown>,
): { ok: true } | { ok: false; error: string } {
  const size = JSON.stringify(payload).length;
  if (size > MAX_PAYLOAD_BYTES) {
    return {
      ok: false,
      error: `payload too large (${size} bytes, max ${MAX_PAYLOAD_BYTES})`,
    };
  }
  if (action === "send_otis") {
    const title = payload.title;
    const body = payload.body;
    if (typeof title !== "string" || title.trim().length === 0) {
      return { ok: false, error: "send_otis requires a non-empty title" };
    }
    if (title.length > MAX_TITLE_LEN) {
      return { ok: false, error: `title too long (max ${MAX_TITLE_LEN})` };
    }
    if (body !== undefined && (typeof body !== "string" || body.length > MAX_BODY_LEN)) {
      return { ok: false, error: `body too long (max ${MAX_BODY_LEN})` };
    }
  }
  if (action === "fix_issue") {
    if (typeof payload.issue_number !== "number") {
      return { ok: false, error: "fix_issue requires a numeric issue_number" };
    }
  }
  return { ok: true };
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
  const pv = validatePayload(args.action, args.payload);
  if (!pv.ok) throw new Error(pv.error);
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

  // QA3: validate the payload when either the payload or the action changes.
  if (patch.payload !== undefined || patch.action !== undefined) {
    const effectiveAction = patch.action ?? existing.action;
    const effectivePayload =
      patch.payload ??
      (JSON.parse(existing.payload_json) as Record<string, unknown>);
    const pv = validatePayload(effectiveAction, effectivePayload);
    if (!pv.ok) throw new Error(pv.error);
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
 * QA3 (R3 finding 6): atomically CLAIM a due cron for firing, cross-process.
 *
 * The dashboard (Next.js) and the coordinator (daemon) are separate processes
 * that both tick the scheduler. An in-memory `ticking` guard can't coordinate
 * across processes, so both could see the same cron as due and fire it twice
 * (two reviewer subprocesses, two duplicate issues, etc).
 *
 * This advances `next_run_at` in a single conditional UPDATE keyed on the
 * exact value the caller read. Only ONE process's UPDATE will match (the
 * others find next_run_at already moved). `changes > 0` means "you won the
 * claim — fire it." The schedule is advanced as part of the claim, so the
 * history row is recorded separately by `recordCronRun`.
 */
export function claimDueCron(cron: CronRow): boolean {
  const now = Date.now();
  const next = nextFireAt(cron.schedule, now);
  const res = db
    .prepare(
      `UPDATE crons SET next_run_at = ?, last_run_at = ?, updated_at = ?
         WHERE id = ? AND next_run_at = ?`,
    )
    .run(next, now, now, cron.id, cron.next_run_at);
  return res.changes > 0;
}

/** Record a cron-fire result in history. Separate from the claim (above). */
export function recordCronRun(
  cronId: number,
  result: { ok: boolean; message: string; runId?: number },
): void {
  const now = Date.now();
  try {
    db.prepare(
      `INSERT INTO cron_runs (cron_id, started_at, finished_at, ok, message, run_id)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).run(cronId, now, now, result.ok ? 1 : 0, result.message, result.runId ?? null);
  } catch (err) {
    // Cron deleted between claim and history insert → FK violation. Skip.
    const msg = err instanceof Error ? err.message : String(err);
    if (!/FOREIGN KEY/i.test(msg)) throw err;
  }
}

/**
 * QA3 (R3 finding 7): prune cron_runs older than the retention window so a
 * high-frequency cron (one firing every 5 minutes is ~8.6k rows/month) can't
 * grow the DB unbounded. Called from the coordinator's 6h reaper.
 */
export function pruneCronRuns(retentionDays = 90): number {
  const cutoff = Date.now() - retentionDays * 24 * 60 * 60 * 1000;
  const res = db
    .prepare(`DELETE FROM cron_runs WHERE started_at < ?`)
    .run(cutoff);
  return res.changes;
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
