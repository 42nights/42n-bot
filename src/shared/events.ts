import { db } from "../db";

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

export function emitEvent(runId: number, kind: EventKind, payload: unknown = {}) {
  db.prepare(
    `INSERT INTO events (run_id, ts, kind, payload_json) VALUES (?, ?, ?, ?)`,
  ).run(runId, Date.now(), kind, JSON.stringify(payload));
}
