import { embedOne } from "../embeddings/openai";

/**
 * Cosine-similarity dedupe between a candidate issue and the open issue set.
 * Threshold 0.78 ≈ "this is basically the same issue, phrased differently."
 * Below that, even close-sounding issues are usually distinct.
 */
export async function isDuplicate(args: {
  candidate: { title: string; body: string };
  existing: { number: number; title: string; body: string }[];
  threshold?: number;
}): Promise<{
  duplicate: boolean;
  nearest?: { number: number; score: number };
}> {
  const threshold = args.threshold ?? 0.78;
  if (!args.existing.length) return { duplicate: false };

  const candText = `${args.candidate.title}\n\n${args.candidate.body.slice(0, 500)}`;
  const candVec = await embedOne(candText);

  let bestScore = -Infinity;
  let bestNumber = -1;
  for (const e of args.existing) {
    const eText = `${e.title}\n\n${e.body.slice(0, 500)}`;
    const eVec = await embedOne(eText);
    let dot = 0;
    for (let i = 0; i < candVec.length; i++) dot += candVec[i] * eVec[i];
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
