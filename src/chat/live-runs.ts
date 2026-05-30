import { db } from "../db";

const ACTIVE_STATUSES = [
  "queued",
  "planning",
  "implementing",
  "verifying",
  "iterating",
];

export type LiveRunBrief = {
  id: number;
  type: string;
  repo: string;
  issue_number: number | null;
  issue_title: string | null;
  status: string;
  started_at: number;
  cost_usd: number;
  recent_events: Array<{ kind: string; payload: string; ts: number }>;
};

/**
 * Snapshot of every run currently in-flight, with the last ~5 events for each.
 * The chat layer prepends this to the LLM context so questions like
 * "what is the bot doing right now" can be answered even though the corpus
 * only indexes terminal runs.
 */
export function liveRuns(): LiveRunBrief[] {
  const runs = db
    .prepare(
      `SELECT id, type, repo, issue_number, issue_title, status, started_at, cost_usd
         FROM runs
         WHERE status IN (${ACTIVE_STATUSES.map(() => "?").join(",")})
         ORDER BY started_at DESC
         LIMIT 20`,
    )
    .all(...ACTIVE_STATUSES) as Omit<LiveRunBrief, "recent_events">[];

  return runs.map((r) => {
    const events = db
      .prepare(
        `SELECT kind, payload_json, ts FROM events
           WHERE run_id = ?
           ORDER BY ts DESC
           LIMIT 6`,
      )
      .all(r.id) as Array<{ kind: string; payload_json: string; ts: number }>;
    return {
      ...r,
      recent_events: events
        .reverse()
        .map((e) => ({ kind: e.kind, payload: e.payload_json, ts: e.ts })),
    };
  });
}

/**
 * Render the live snapshot as a markdown chunk to inject into the chat
 * prompt. Empty string when nothing is running, so we don't waste tokens.
 */
export function renderLiveRunsContext(): string {
  const runs = liveRuns();
  if (!runs.length) return "";
  const lines: string[] = ["<live_runs>"];
  for (const r of runs) {
    const age = Math.round((Date.now() - r.started_at) / 1000);
    const issueLabel =
      r.issue_number != null
        ? `#${r.issue_number} ${r.issue_title ?? ""}`
        : "(no issue)";
    lines.push(
      `Run #${r.id} [${r.type}, ${r.status}, ${age}s in, $${r.cost_usd.toFixed(4)}] — ${r.repo} ${issueLabel}`,
    );
    for (const e of r.recent_events) {
      lines.push(`  · ${e.kind}: ${e.payload.slice(0, 160)}`);
    }
  }
  lines.push("</live_runs>");
  return lines.join("\n");
}
