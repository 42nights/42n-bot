import { CronExpressionParser } from "cron-parser";
import {
  listCrons as listCronsOp,
  getCron as getCronOp,
  createCronRow,
  updateCronRow,
  deleteCronRow,
  getDueCrons,
  claimDueCron as claimDueCronOp,
  recordCronRunRow,
  pruneCronRunRows,
  listCronRunRows,
  type CronRow,
  type CronRunRow,
} from "../db/ops/crons";

export type CronAction = "reviewer" | "fix_issue" | "send_otis";
export type { CronRow, CronRunRow };

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

export async function listCrons(): Promise<CronRow[]> {
  return listCronsOp();
}

export async function getCron(id: string): Promise<CronRow | null> {
  return getCronOp(id);
}

const MAX_PAYLOAD_BYTES = 16 * 1024;
const MAX_TITLE_LEN = 256;
const MAX_BODY_LEN = 8 * 1024;

export function validatePayload(
  action: CronAction,
  payload: Record<string, unknown>,
): { ok: true } | { ok: false; error: string } {
  const size = JSON.stringify(payload).length;
  if (size > MAX_PAYLOAD_BYTES) {
    return { ok: false, error: `payload too large (${size} bytes, max ${MAX_PAYLOAD_BYTES})` };
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

export async function createCron(args: {
  name: string;
  schedule: string;
  action: CronAction;
  payload: Record<string, unknown>;
  repo: string | null;
  enabled: boolean;
}): Promise<CronRow> {
  const v = validateSchedule(args.schedule);
  if (!v.ok) throw new Error(`Bad cron schedule "${args.schedule}": ${v.error}`);
  const pv = validatePayload(args.action, args.payload);
  if (!pv.ok) throw new Error(pv.error);
  const now = Date.now();
  const id = await createCronRow({
    name: args.name,
    schedule: args.schedule,
    action: args.action,
    payload_json: JSON.stringify(args.payload),
    repo: args.repo,
    enabled: args.enabled ? 1 : 0,
    next_run_at: v.nextRun ?? undefined,
    created_at: now,
    updated_at: now,
  });
  const row = await getCronOp(id);
  if (!row) throw new Error("cron create failed");
  return row;
}

export async function updateCron(
  id: string,
  patch: Partial<{
    name: string;
    schedule: string;
    action: CronAction;
    payload: Record<string, unknown>;
    repo: string | null;
    enabled: boolean;
  }>,
): Promise<CronRow | null> {
  const existing = await getCronOp(id);
  if (!existing) return null;

  let nextRunAt = existing.next_run_at;
  let schedule = existing.schedule;
  if (patch.schedule !== undefined && patch.schedule !== existing.schedule) {
    const v = validateSchedule(patch.schedule);
    if (!v.ok) throw new Error(`Bad cron schedule "${patch.schedule}": ${v.error}`);
    schedule = patch.schedule;
    nextRunAt = v.nextRun ?? undefined;
  }

  if (patch.payload !== undefined || patch.action !== undefined) {
    const effectiveAction = (patch.action ?? existing.action) as CronAction;
    const effectivePayload =
      patch.payload ??
      (JSON.parse(existing.payload_json) as Record<string, unknown>);
    const pv = validatePayload(effectiveAction, effectivePayload);
    if (!pv.ok) throw new Error(pv.error);
  }

  const dbPatch: Record<string, unknown> = {
    schedule,
    next_run_at: nextRunAt,
    updated_at: Date.now(),
  };
  if (patch.name !== undefined) dbPatch.name = patch.name;
  if (patch.action !== undefined) dbPatch.action = patch.action;
  if (patch.payload !== undefined) dbPatch.payload_json = JSON.stringify(patch.payload);
  if (patch.repo !== undefined) dbPatch.repo = patch.repo;
  if (patch.enabled !== undefined) dbPatch.enabled = patch.enabled ? 1 : 0;

  return updateCronRow(id, dbPatch);
}

export async function deleteCron(id: string): Promise<boolean> {
  return deleteCronRow(id);
}

export async function dueCrons(limit = 10): Promise<CronRow[]> {
  return getDueCrons(Date.now(), limit);
}

export async function claimDueCron(cron: CronRow): Promise<boolean> {
  const now = Date.now();
  const next = nextFireAt(cron.schedule, now);
  return claimDueCronOp(cron._id, cron.next_run_at, next ?? undefined, now);
}

export async function recordCronRun(
  cronId: string,
  result: { ok: boolean; message: string; runId?: string },
): Promise<void> {
  await recordCronRunRow({
    cron_id: cronId,
    ok: result.ok,
    message: result.message,
    run_id: result.runId,
  }).catch((err) => {
    const msg = err instanceof Error ? err.message : String(err);
    if (!/FOREIGN KEY|not found/i.test(msg)) throw err;
  });
}

export async function pruneCronRuns(retentionDays = 90): Promise<number> {
  const cutoff = Date.now() - retentionDays * 24 * 60 * 60 * 1000;
  return pruneCronRunRows(cutoff);
}

export async function listCronRuns(
  cronId: string,
  limit = 50,
): Promise<CronRunRow[]> {
  return listCronRunRows(cronId, limit);
}
