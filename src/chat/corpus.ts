import { db } from "../db";
import { embedBatch, EMBED_DIM } from "../embeddings/openai";
import { log } from "../shared/logger";

function bufToVec(b: Buffer): Float32Array {
  // A4: SQLite BLOB buffers are not guaranteed to land on a 4-byte boundary,
  // and `new Float32Array(b.buffer, b.byteOffset, EMBED_DIM)` throws an
  // alignment error when `b.byteOffset % 4 !== 0`. Copy first to realign.
  const copy = Buffer.from(b);
  return new Float32Array(copy.buffer, copy.byteOffset, EMBED_DIM);
}
function vecToBuf(v: Float32Array): Buffer {
  return Buffer.from(v.buffer, v.byteOffset, v.byteLength);
}

/**
 * Render a completed run into a markdown summary chunk for the RAG corpus.
 *
 * D3: also includes the latest plan + critic detail when available, so chat
 * questions about edge cases / hidden bugs / plan complexity can be answered
 * — not just timeline-style activity questions.
 */
export function summarizeRun(runId: number): string | null {
  const run = db
    .prepare(`SELECT * FROM runs WHERE id = ?`)
    .get(runId) as Record<string, unknown> & {
    id: number;
    type: string;
    repo: string;
    issue_number: number | null;
    issue_title: string | null;
    status: string;
    attempts: number;
    cost_usd: number;
    started_at: number;
    finished_at: number | null;
    pr_number: number | null;
    error_message: string | null;
  } | undefined;
  if (!run) return null;

  const verdicts = db
    .prepare(`SELECT attempt, pass, failure_summary, checks_json FROM verdicts WHERE run_id = ? ORDER BY attempt`)
    .all(runId) as Array<{
    attempt: number;
    pass: number;
    failure_summary: string | null;
    checks_json: string;
  }>;

  const events = db
    .prepare(`SELECT kind FROM events WHERE run_id = ? ORDER BY id`)
    .all(runId) as Array<{ kind: string }>;
  const kinds = events.map((e) => e.kind);

  const planArt = db
    .prepare(
      `SELECT content FROM artifacts WHERE run_id = ? AND kind = 'plan' ORDER BY id DESC LIMIT 1`,
    )
    .get(runId) as { content: string } | undefined;

  const lines: string[] = [];
  lines.push(`# Run #${run.id} — ${run.type}`);
  if (run.issue_number) {
    lines.push(`Issue: #${run.issue_number} "${run.issue_title ?? ""}"`);
  }
  lines.push(`Repo: ${run.repo}`);
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
  if (run.error_message) lines.push(`Error: ${run.error_message}`);

  // Plan summary (one paragraph).
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
    } catch {/* malformed plan artifact — skip */}
  }

  if (verdicts.length) {
    lines.push("");
    lines.push("## Verdicts");
    for (const v of verdicts) {
      lines.push(
        `- Attempt ${v.attempt}: ${v.pass ? "pass" : "fail"}${v.failure_summary ? ` — ${v.failure_summary.slice(0, 200)}` : ""}`,
      );
    }
    // Pull the latest critic detail (if present) and inline it. This is what
    // makes "what edge cases did the critic flag?" answerable.
    try {
      const latest = JSON.parse(verdicts[verdicts.length - 1].checks_json) as {
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
    } catch {/* checks_json malformed */}
  }
  if (kinds.length) {
    lines.push("");
    lines.push(`## Activity trail`);
    lines.push(kinds.join(" → "));
  }
  return lines.join("\n");
}

/**
 * Walk runs that are terminal and don't yet have a corpus chunk, summarize
 * them, embed, and persist. Idempotent.
 */
export async function refreshChatCorpus(): Promise<{ added: number }> {
  const candidates = db
    .prepare(
      `SELECT r.id FROM runs r
         LEFT JOIN corpus_chunks c ON c.run_id = r.id
         WHERE r.status IN ('pr-opened','succeeded','needs-review','failed','abandoned')
           AND c.id IS NULL`,
    )
    .all() as Array<{ id: number }>;

  if (!candidates.length) return { added: 0 };

  const summaries = candidates
    .map((c) => ({ runId: c.id, text: summarizeRun(c.id) }))
    .filter((s): s is { runId: number; text: string } => Boolean(s.text));

  if (!summaries.length) return { added: 0 };

  try {
    const vectors = await embedBatch(summaries.map((s) => s.text));
    const insert = db.prepare(
      `INSERT INTO corpus_chunks (run_id, text, embedding, created_at) VALUES (?, ?, ?, ?)`,
    );
    const tx = db.transaction(() => {
      for (let i = 0; i < summaries.length; i++) {
        insert.run(
          summaries[i].runId,
          summaries[i].text,
          vecToBuf(vectors[i]),
          Date.now(),
        );
      }
    });
    tx();
    log.info("chat", `corpus refreshed: added ${summaries.length}`);
    return { added: summaries.length };
  } catch (err) {
    log.warn("chat", `corpus refresh failed: ${err}`);
    // Store summaries WITHOUT embeddings — still useful for keyword search.
    const insert = db.prepare(
      `INSERT INTO corpus_chunks (run_id, text, embedding, created_at) VALUES (?, ?, NULL, ?)`,
    );
    const tx = db.transaction(() => {
      for (const s of summaries) insert.run(s.runId, s.text, Date.now());
    });
    tx();
    return { added: summaries.length };
  }
}

export type CorpusHit = {
  chunkId: number;
  runId: number | null;
  text: string;
  score: number;
};

export async function searchCorpus(query: string, limit = 8): Promise<CorpusHit[]> {
  // B10: cap the working set. v0 keeps the most-recent 5k chunks; old runs
  // age out of search but stay in the audit DB. A full in-memory index
  // hydrated at startup is the v1 fix.
  const rows = db
    .prepare(
      `SELECT id, run_id, text, embedding FROM corpus_chunks
         ORDER BY created_at DESC LIMIT 5000`,
    )
    .all() as Array<{ id: number; run_id: number | null; text: string; embedding: Buffer | null }>;
  if (!rows.length) return [];

  // If we can embed the query, do cosine. Otherwise keyword fallback.
  let qVec: Float32Array | null = null;
  if (process.env.OPENAI_API_KEY) {
    try {
      const [v] = await embedBatch([query]);
      qVec = v;
    } catch {
      qVec = null;
    }
  }

  const scored: CorpusHit[] = [];
  for (const r of rows) {
    if (qVec && r.embedding) {
      const v = bufToVec(r.embedding);
      let s = 0;
      for (let i = 0; i < v.length; i++) s += qVec[i] * v[i];
      scored.push({ chunkId: r.id, runId: r.run_id, text: r.text, score: s });
    } else {
      const qWords = query.toLowerCase().split(/\W+/).filter(Boolean);
      const lower = r.text.toLowerCase();
      const hits = qWords.filter((w) => lower.includes(w)).length;
      scored.push({
        chunkId: r.id,
        runId: r.run_id,
        text: r.text,
        score: hits / Math.max(qWords.length, 1),
      });
    }
  }
  return scored.sort((a, b) => b.score - a.score).slice(0, limit);
}
