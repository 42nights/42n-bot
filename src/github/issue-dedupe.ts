import { embedBatch, activeEmbedDim } from "../embeddings";
import { db } from "../db";

/**
 * Cosine-similarity dedupe between a candidate issue and the open issue set.
 * Threshold 0.78 ≈ "this is basically the same issue, phrased differently."
 *
 * B1: a single `embedBatch` call covers candidate + every existing issue we
 * don't already have a cached embedding for. Old design did N+1 individual
 * round-trips, ~$0.30/run instead of the few-cents this costs now.
 *
 * C5: existing-issue embeddings get persisted in `issue_embeddings`, keyed by
 * (repo, issue_number) with GitHub's `updated_at` as the freshness signal.
 * Hit the cache when GitHub hasn't bumped updated_at; otherwise re-embed.
 */
export async function isDuplicate(args: {
  repo: string;
  candidate: { title: string; body: string };
  existing: {
    number: number;
    title: string;
    body: string;
    updated_at: string;
  }[];
  threshold?: number;
}): Promise<{
  duplicate: boolean;
  nearest?: { number: number; score: number };
}> {
  const threshold = args.threshold ?? 0.78;
  if (!args.existing.length) return { duplicate: false };

  const candText = textFor(args.candidate.title, args.candidate.body);

  const cached = new Map<number, Float32Array>();
  const needsEmbed: { issue_number: number; text: string }[] = [];

  for (const e of args.existing) {
    const hit = lookupCache(args.repo, e.number, e.updated_at);
    if (hit) {
      cached.set(e.number, hit);
    } else {
      needsEmbed.push({
        issue_number: e.number,
        text: textFor(e.title, e.body),
      });
    }
  }

  // One batch call: [candidate, ...uncached existing texts].
  const texts = [candText, ...needsEmbed.map((n) => n.text)];
  const vectors = await embedBatch(texts);
  const candVec = vectors[0];
  for (let i = 0; i < needsEmbed.length; i++) {
    const v = vectors[i + 1];
    const e = needsEmbed[i];
    const issue = args.existing.find((x) => x.number === e.issue_number);
    if (issue) {
      writeCache(args.repo, e.issue_number, issue.updated_at, v);
      cached.set(e.issue_number, v);
    }
  }

  let bestScore = -Infinity;
  let bestNumber = -1;
  for (const e of args.existing) {
    const vec = cached.get(e.number);
    if (!vec) continue;
    let dot = 0;
    for (let i = 0; i < candVec.length; i++) dot += candVec[i] * vec[i];
    if (dot > bestScore) {
      bestScore = dot;
      bestNumber = e.number;
    }
  }
  if (bestScore >= threshold) {
    return {
      duplicate: true,
      nearest: { number: bestNumber, score: bestScore },
    };
  }
  return { duplicate: false };
}

function textFor(title: string, body: string): string {
  return `${title}\n\n${body.slice(0, 500)}`;
}

function bufToVec(b: Buffer): Float32Array | null {
  const copy = Buffer.from(b);
  const dim = activeEmbedDim();
  if (copy.byteLength !== dim * 4) return null;
  return new Float32Array(copy.buffer, copy.byteOffset, dim);
}
function vecToBuf(v: Float32Array): Buffer {
  return Buffer.from(v.buffer, v.byteOffset, v.byteLength);
}

function lookupCache(
  repo: string,
  issueNumber: number,
  updatedAt: string,
): Float32Array | null {
  const row = db
    .prepare(
      `SELECT updated_at, embedding FROM issue_embeddings WHERE repo=? AND issue_number=?`,
    )
    .get(repo, issueNumber) as
    | { updated_at: string; embedding: Buffer }
    | undefined;
  if (!row) return null;
  if (row.updated_at !== updatedAt) return null;
  return bufToVec(row.embedding);  // returns null on dim mismatch (e.g., user swapped backends)
}

function writeCache(
  repo: string,
  issueNumber: number,
  updatedAt: string,
  vec: Float32Array,
) {
  db.prepare(
    `INSERT INTO issue_embeddings (repo, issue_number, updated_at, embedding, cached_at)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(repo, issue_number) DO UPDATE
       SET updated_at=excluded.updated_at,
           embedding=excluded.embedding,
           cached_at=excluded.cached_at`,
  ).run(repo, issueNumber, updatedAt, vecToBuf(vec), Date.now());
}
