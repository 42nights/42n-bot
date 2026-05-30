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
 *
 * QA3 (R3 finding 14): the previous read-then-update was non-atomic — a
 * webhook flipping dirty=1 between the SELECT and the UPDATE would have its
 * signal clobbered to 0 and lost. We now clear-and-detect in a SINGLE
 * statement: `UPDATE ... SET dirty=0 WHERE name=? AND dirty=1` returns
 * `changes=1` only if it actually transitioned a dirty row, so any signal
 * raised after this statement starts keeps dirty=1 for the next tick.
 */
export function consumeDispatch(name: DispatchName): boolean {
  const res = db
    .prepare(
      `UPDATE dispatch_signals SET dirty=0, updated_at=? WHERE name=? AND dirty=1`,
    )
    .run(Date.now(), name);
  return res.changes > 0;
}
