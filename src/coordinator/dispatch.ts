import { db } from "../db";

/**
 * Cross-process dispatch signals. The webhook flips `dirty=1`; the
 * coordinator drains on a 2s tick. SQLite is the broker because the webhook
 * (Next.js process) and the coordinator (standalone daemon) don't share
 * memory.
 *
 * Two signals today:
 *  - "implementer": polled when an issue label changes or a new issue opens
 *  - "reviewer":    polled to fire a one-off reviewer pass on demand
 */

export type DispatchName = "implementer" | "reviewer";

export function requestDispatch(name: DispatchName) {
  db.prepare(
    `INSERT INTO dispatch_signals (name, dirty, updated_at) VALUES (?, 1, ?)
       ON CONFLICT(name) DO UPDATE SET dirty=1, updated_at=excluded.updated_at`,
  ).run(name, Date.now());
}

/**
 * Returns true if the signal was dirty (and atomically clears it). Used by
 * the coordinator's tight 2s tick.
 */
export function consumeDispatch(name: DispatchName): boolean {
  const row = db
    .prepare(
      `SELECT dirty FROM dispatch_signals WHERE name = ?`,
    )
    .get(name) as { dirty: number } | undefined;
  if (!row || !row.dirty) return false;
  db.prepare(`UPDATE dispatch_signals SET dirty=0, updated_at=? WHERE name=?`)
    .run(Date.now(), name);
  return true;
}
