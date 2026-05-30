/**
 * Single source of truth for run lifecycle statuses.
 *
 * QA3 (R3 finding 20): the coordinator and the worktree-recovery code each
 * hardcoded their own copy of "which statuses count as active." If they drift,
 * a crashed run in a status one of them doesn't know about gets orphaned
 * (worktree + branch left on disk until the 7-day reaper). Both now import
 * from here.
 *
 * ACTIVE = a run is still in flight (not terminal). An allowlist, so a new
 * status that isn't added here fails closed: the coordinator will re-pick the
 * issue rather than silently treating it as permanently active.
 */
export const ACTIVE_STATUSES = [
  "queued",
  "planning",
  "implementing",
  "iterating",
  "verifying",
] as const;

export type ActiveStatus = (typeof ACTIVE_STATUSES)[number];

export const TERMINAL_STATUSES = [
  "pr-opened",
  "succeeded",
  "needs-review",
  "failed",
  "abandoned",
] as const;
