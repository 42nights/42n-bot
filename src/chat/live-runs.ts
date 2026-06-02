import { getActiveRuns } from "../db/ops/runs";
import { listEventsByRunAfterCursor } from "../db/ops/events";

export type LiveRunBrief = {
  id: string;
  type: string;
  repo: string;
  issue_number: number | null;
  issue_title: string | null;
  status: string;
  started_at: number;
  cost_usd: number;
  recent_events: Array<{ kind: string; payload: string; ts: number }>;
};

export async function liveRuns(): Promise<LiveRunBrief[]> {
  const runs = await getActiveRuns();

  return Promise.all(
    runs.map(async (r) => {
      const events = await listEventsByRunAfterCursor(r._id);
      const recent = events
        .slice(-6)
        .map((e) => ({ kind: e.kind, payload: e.payload_json, ts: e.ts }));
      return {
        id: r._id,
        type: r.type,
        repo: r.repo,
        issue_number: r.issue_number ?? null,
        issue_title: r.issue_title ?? null,
        status: r.status,
        started_at: r.started_at,
        cost_usd: r.cost_usd,
        recent_events: recent,
      };
    }),
  );
}

export async function renderLiveRunsContext(): Promise<string> {
  const runs = await liveRuns();
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
