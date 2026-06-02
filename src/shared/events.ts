import { insertEvent } from "../db/ops/events";

export type EventKind =
  | "run.created"
  | "run.status"
  | "plan.started"
  | "plan.completed"
  | "plan.aborted"
  | "implement.started"
  | "implement.tool_use"
  | "implement.text_delta"
  | "implement.completed"
  | "implement.failed"
  | "verification.started"
  | "verification.check_started"
  | "verification.check_completed"
  | "verification.completed"
  | "iteration.started"
  | "pr.opened"
  | "pr.needs_review"
  | "pr.failed"
  | "pr.merged"
  | "run.finished"
  | "run.worktree_broken"
  | "claude.subprocess.spawned"
  | "claude.subprocess.exit"
  | "claude.budget_exceeded"
  | "review.started"
  | "review.proposed"
  | "review.deduped"
  | "review.opened_issue"
  | "understand.started"
  | "understand.completed"
  | "understand.failed"
  | "reproduce.started"
  | "reproduce.completed"
  | "reproduce.failed"
  | "design.started"
  | "design.completed"
  | "design.failed"
  | "replan.started"
  | "replan.completed"
  | "replan.failed"
  | "log";

export function emitEvent(
  runId: string,
  kind: EventKind,
  payload: unknown = {},
): void {
  // Fire-and-forget — the coordinator is a long-running Node process; a
  // dropped event is less harmful than blocking Claude Code progression.
  insertEvent(runId, kind, payload).catch((err) => {
    // eslint-disable-next-line no-console
    console.error(`emitEvent(${kind}) failed:`, err);
  });
}
