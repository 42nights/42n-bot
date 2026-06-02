import {
  getMissingCorpusRunIds,
  listRecentCorpusChunks,
  insertCorpusChunksBatch,
  type CorpusChunkRow,
} from "../db/ops/corpus";
import { getRun } from "../db/ops/runs";
import { listVerdictsByRun } from "../db/ops/verdicts";
import { listEventsByRun } from "../db/ops/events";
import { listArtifactsByRun } from "../db/ops/artifacts";
import { embedBatch, activeEmbedDim } from "../embeddings";
import { log } from "../shared/logger";

function sanitizeField(s: string | null | undefined, max = 300): string {
  if (!s) return "";
  return s
    .replace(/[`\r\n]+/g, " ")
    .replace(/"/g, "'")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

export async function summarizeRun(runId: string): Promise<string | null> {
  const run = await getRun(runId);
  if (!run) return null;

  const verdicts = await listVerdictsByRun(runId);
  const events = await listEventsByRun(runId);
  const artifacts = await listArtifactsByRun(runId);

  const kinds = events.map((e) => e.kind);
  const planArt = artifacts
    .filter((a) => a.kind === "plan")
    .sort((a, b) => b.created_at - a.created_at)[0];

  const lines: string[] = [];
  lines.push(`# Run #${run._id} — ${run.type}`);
  if (run.issue_number) {
    lines.push(`Issue: #${run.issue_number} "${sanitizeField(run.issue_title)}"`);
  }
  lines.push(`Repo: ${sanitizeField(run.repo, 120)}`);
  lines.push(`Status: ${run.status}`);
  lines.push(`Started: ${new Date(run.started_at).toISOString()}`);
  if (run.finished_at) {
    lines.push(
      `Finished: ${new Date(run.finished_at).toISOString()} (${Math.round((run.finished_at - run.started_at) / 1000)}s)`,
    );
  }
  lines.push(`Attempts: ${run.attempts}`);
  lines.push(`Cost: $${run.cost_usd.toFixed(4)}`);
  if (run.pr_number) lines.push(`PR: #${run.pr_number}`);
  if (run.error_message) lines.push(`Error: ${sanitizeField(run.error_message, 400)}`);

  if (planArt?.content) {
    try {
      const plan = JSON.parse(planArt.content) as {
        user_visible_change?: string;
        complexity?: string;
        files_to_change?: Array<{ path: string }>;
        tests_to_add_or_update?: Array<{ path: string }>;
        edge_cases?: string[];
      };
      lines.push("");
      lines.push("## Plan");
      if (plan.user_visible_change)
        lines.push(`Change: ${plan.user_visible_change}`);
      if (plan.complexity) lines.push(`Complexity: ${plan.complexity}`);
      const files = plan.files_to_change?.map((f) => f.path) ?? [];
      if (files.length) lines.push(`Files: ${files.join(", ")}`);
      const tests = plan.tests_to_add_or_update?.map((t) => t.path) ?? [];
      if (tests.length) lines.push(`Tests: ${tests.join(", ")}`);
      if (plan.edge_cases?.length)
        lines.push(`Edge cases planned: ${plan.edge_cases.join("; ")}`);
    } catch {
      /* malformed plan artifact */
    }
  }

  if (verdicts.length) {
    lines.push("");
    lines.push("## Verdicts");
    for (const v of verdicts) {
      lines.push(
        `- Attempt ${v.attempt}: ${v.pass ? "pass" : "fail"}${v.failure_summary ? ` — ${v.failure_summary.slice(0, 200)}` : ""}`,
      );
    }
    try {
      const latest = JSON.parse(
        verdicts[verdicts.length - 1].checks_json,
      ) as {
        critic?: {
          detail?: {
            merge_confidence?: number;
            one_line_summary?: string;
            missed_edge_cases?: string[];
            hidden_bugs?: Array<{ description: string; severity: string }>;
            test_depth?: string;
            implements_issue?: string;
          };
        };
      };
      const c = latest.critic?.detail;
      if (c) {
        lines.push("");
        lines.push("## Critic");
        if (c.one_line_summary) lines.push(`Summary: ${c.one_line_summary}`);
        if (typeof c.merge_confidence === "number")
          lines.push(`Confidence: ${c.merge_confidence}/100`);
        if (c.implements_issue) lines.push(`Implements issue: ${c.implements_issue}`);
        if (c.test_depth) lines.push(`Test depth: ${c.test_depth}`);
        if (c.missed_edge_cases?.length) {
          lines.push("Missed edge cases:");
          for (const e of c.missed_edge_cases) lines.push(`  - ${e}`);
        }
        if (c.hidden_bugs?.length) {
          lines.push("Hidden bugs flagged:");
          for (const b of c.hidden_bugs) lines.push(`  - [${b.severity}] ${b.description}`);
        }
      }
    } catch {
      /* checks_json malformed */
    }
  }
  if (kinds.length) {
    lines.push("");
    lines.push("## Activity trail");
    lines.push(kinds.join(" → "));
  }
  return lines.join("\n");
}

export async function refreshChatCorpus(): Promise<{ added: number }> {
  const candidateIds = await getMissingCorpusRunIds([
    "pr-opened",
    "succeeded",
    "needs-review",
    "failed",
    "abandoned",
  ]);
  if (!candidateIds.length) return { added: 0 };

  const summaries = (
    await Promise.all(
      candidateIds.map(async (id) => {
        const text = await summarizeRun(id);
        return text ? { runId: id, text } : null;
      }),
    )
  ).filter((s): s is { runId: string; text: string } => Boolean(s));

  if (!summaries.length) return { added: 0 };

  try {
    const vectors = await embedBatch(summaries.map((s) => s.text));
    await insertCorpusChunksBatch(
      summaries.map((s, i) => ({
        run_id: s.runId,
        text: s.text,
        embedding: Array.from(vectors[i]),
        created_at: Date.now(),
      })),
    );
    log.info("chat", `corpus refreshed: added ${summaries.length}`);
    return { added: summaries.length };
  } catch (err) {
    log.warn("chat", `corpus refresh failed: ${err}`);
    await insertCorpusChunksBatch(
      summaries.map((s) => ({
        run_id: s.runId,
        text: s.text,
        embedding: null,
        created_at: Date.now(),
      })),
    );
    return { added: summaries.length };
  }
}

export type CorpusHit = {
  chunkId: string;
  runId: string | null;
  text: string;
  score: number;
};

export async function searchCorpus(
  query: string,
  limit = 8,
): Promise<CorpusHit[]> {
  const rows = await listRecentCorpusChunks(5000);
  if (!rows.length) return [];

  let qVec: Float32Array | null = null;
  try {
    const [v] = await embedBatch([query]);
    qVec = v;
  } catch {
    qVec = null;
  }

  const dim = activeEmbedDim();
  const scored: CorpusHit[] = [];
  for (const r of rows) {
    const stored =
      r.embedding && r.embedding.length === dim
        ? new Float32Array(r.embedding)
        : null;
    if (qVec && stored) {
      let s = 0;
      for (let i = 0; i < stored.length; i++) s += qVec[i] * stored[i];
      scored.push({
        chunkId: r._id,
        runId: r.run_id ?? null,
        text: r.text,
        score: s,
      });
    } else {
      const qWords = query.toLowerCase().split(/\W+/).filter(Boolean);
      const lower = r.text.toLowerCase();
      const hits = qWords.filter((w) => lower.includes(w)).length;
      scored.push({
        chunkId: r._id,
        runId: r.run_id ?? null,
        text: r.text,
        score: hits / Math.max(qWords.length, 1),
      });
    }
  }
  return scored.sort((a, b) => b.score - a.score).slice(0, limit);
}
