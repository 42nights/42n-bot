import { describe, it, expect, vi } from "vitest";

// Mock the embeddings module so we can drive cosine similarity deterministically.
function toVec(text: string): Float32Array {
  // Stable hash → unit vector with one big component. Texts that share the
  // first 6 chars get colinear vectors; otherwise orthogonal.
  const seed = text.slice(0, 6);
  const v = new Float32Array(1536);
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) | 0;
  const idx = Math.abs(h) % 1536;
  v[idx] = 1;
  return v;
}
vi.mock("../src/embeddings/openai", () => ({
  EMBED_DIM: 1536,
  embedOne: async (text: string) => toVec(text),
  embedBatch: async (texts: string[]) => texts.map(toVec),
}));
// Stub the DB cache layer so test runs don't touch a real data/bot.db.
vi.mock("../src/db", () => ({
  db: {
    prepare: () => ({
      get: () => undefined,
      run: () => undefined,
    }),
  },
}));

import { isDuplicate } from "../src/github/issue-dedupe";

describe("isDuplicate", () => {
  it("returns false when nothing exists", async () => {
    const r = await isDuplicate({
      repo: "owner/repo",
      candidate: { title: "Add retry to webhook handler", body: "" },
      existing: [],
    });
    expect(r.duplicate).toBe(false);
  });

  it("flags near-identical text as a duplicate", async () => {
    const r = await isDuplicate({
      repo: "owner/repo",
      candidate: {
        title: "Helio webhook should retry on 5xx",
        body: "see #123",
      },
      existing: [
        {
          number: 12,
          title: "Helio webhook should retry on 5xx",
          body: "earlier bug report",
          updated_at: "2026-05-01T00:00:00Z",
        },
      ],
      threshold: 0.5,
    });
    expect(r.duplicate).toBe(true);
    expect(r.nearest?.number).toBe(12);
  });

  it("does not flag obviously different issues", async () => {
    const r = await isDuplicate({
      repo: "owner/repo",
      candidate: { title: "Add CSV export", body: "nice to have" },
      existing: [
        {
          number: 7,
          title: "Crash on empty database",
          body: "stack trace…",
          updated_at: "2026-05-01T00:00:00Z",
        },
      ],
      threshold: 0.78,
    });
    expect(r.duplicate).toBe(false);
  });
});
