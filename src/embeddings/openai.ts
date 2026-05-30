import { z } from "zod";

const EMBED_URL = "https://api.openai.com/v1/embeddings";
const MODEL = "text-embedding-3-small";
export const EMBED_DIM = 1536;

const RespSchema = z.object({
  data: z.array(z.object({ embedding: z.array(z.number()) })),
});

function normalize(v: Float32Array): Float32Array {
  let s = 0;
  for (let i = 0; i < v.length; i++) s += v[i] * v[i];
  const n = Math.sqrt(s) || 1;
  for (let i = 0; i < v.length; i++) v[i] /= n;
  return v;
}

export async function embedBatch(texts: string[]): Promise<Float32Array[]> {
  if (texts.length === 0) return [];
  if (!process.env.OPENAI_API_KEY) {
    throw new Error("OPENAI_API_KEY is not set");
  }
  const res = await fetch(EMBED_URL, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
    },
    body: JSON.stringify({ model: MODEL, input: texts }),
  });
  if (!res.ok) {
    throw new Error(
      `embeddings ${res.status}: ${(await res.text()).slice(0, 300)}`,
    );
  }
  const json = RespSchema.parse(await res.json());
  return json.data.map((d) => normalize(new Float32Array(d.embedding)));
}

export async function embedOne(text: string): Promise<Float32Array> {
  // QA5 (R5 finding 7): a malformed API response could yield an empty batch,
  // making `v` undefined and violating the Promise<Float32Array> contract
  // (the caller would cosine-compare `undefined`). Fail explicitly.
  const [v] = await embedBatch([text]);
  if (!v) throw new Error("embedOne: embeddings API returned no vector");
  return v;
}
