import { embedBatch, activeEmbedDim } from "../embeddings";
import {
  lookupIssueEmbedding,
  upsertIssueEmbedding,
} from "../db/ops/issueEmbeddings";

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
    const hit = await lookupCacheAsync(args.repo, e.number, e.updated_at);
    if (hit) {
      cached.set(e.number, hit);
    } else {
      needsEmbed.push({
        issue_number: e.number,
        text: textFor(e.title, e.body),
      });
    }
  }

  const texts = [candText, ...needsEmbed.map((n) => n.text)];
  const vectors = await embedBatch(texts);
  const candVec = vectors[0];
  for (let i = 0; i < needsEmbed.length; i++) {
    const v = vectors[i + 1];
    const e = needsEmbed[i];
    const issue = args.existing.find((x) => x.number === e.issue_number);
    if (issue) {
      await writeCacheAsync(args.repo, e.issue_number, issue.updated_at, v);
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
    return { duplicate: true, nearest: { number: bestNumber, score: bestScore } };
  }
  return { duplicate: false };
}

function textFor(title: string, body: string): string {
  return `${title}\n\n${body.slice(0, 500)}`;
}

async function lookupCacheAsync(
  repo: string,
  issueNumber: number,
  updatedAt: string,
): Promise<Float32Array | null> {
  const row = await lookupIssueEmbedding(repo, issueNumber);
  if (!row) return null;
  if (row.updated_at !== updatedAt) return null;
  const dim = activeEmbedDim();
  if (row.embedding.length !== dim) return null; // backend mismatch
  return new Float32Array(row.embedding);
}

async function writeCacheAsync(
  repo: string,
  issueNumber: number,
  updatedAt: string,
  vec: Float32Array,
): Promise<void> {
  await upsertIssueEmbedding({
    repo,
    issue_number: issueNumber,
    updated_at: updatedAt,
    embedding: Array.from(vec),
    cached_at: Date.now(),
  });
}
