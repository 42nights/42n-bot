import {
  embedBatch as embedBatchOpenAI,
  embedOne as embedOneOpenAI,
  EMBED_DIM as OPENAI_EMBED_DIM,
} from "./openai";
import {
  embedBatchLocal,
  embedOneLocal,
  LOCAL_EMBED_DIM,
} from "./local";

/**
 * Which backend to use. Local (transformers.js, runs in-process, ~25MB
 * one-time download) is the default. Set USE_OPENAI_EMBEDDINGS=1 *and* provide
 * OPENAI_API_KEY to force OpenAI instead.
 */
function useOpenAI(): boolean {
  return (
    process.env.USE_OPENAI_EMBEDDINGS === "1" &&
    Boolean(process.env.OPENAI_API_KEY)
  );
}

export function activeEmbedDim(): number {
  return useOpenAI() ? OPENAI_EMBED_DIM : LOCAL_EMBED_DIM;
}

export const EMBED_DIM = LOCAL_EMBED_DIM;

export async function embedBatch(texts: string[]): Promise<Float32Array[]> {
  return useOpenAI() ? embedBatchOpenAI(texts) : embedBatchLocal(texts);
}

export async function embedOne(text: string): Promise<Float32Array> {
  return useOpenAI() ? embedOneOpenAI(text) : embedOneLocal(text);
}

export function embeddingsBackend(): "local" | "openai" {
  return useOpenAI() ? "openai" : "local";
}
