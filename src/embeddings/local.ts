import type { FeatureExtractionPipeline } from "@huggingface/transformers";
import { log } from "../shared/logger";

const MODEL = "Xenova/all-MiniLM-L6-v2";
export const LOCAL_EMBED_DIM = 384;

let _pipe: FeatureExtractionPipeline | null = null;
let _loading: Promise<FeatureExtractionPipeline> | null = null;

async function getPipe(): Promise<FeatureExtractionPipeline> {
  if (_pipe) return _pipe;
  if (_loading) return _loading;
  log.info("embed", `loading local embedding model ${MODEL} (first call downloads ~25MB)`);
  // Reset `_loading` on rejection so the next call can retry instead of
  // permanently returning the cached rejected promise.
  _loading = (async () => {
    try {
      // Lazy-load transformers so the OpenAI path (prod default) never bundles
      // the ONNX runtime — it would blow Vercel's 250MB serverless function cap.
      const { pipeline } = await import("@huggingface/transformers");
      const p = (await pipeline("feature-extraction", MODEL, {
        cache_dir: process.env.TRANSFORMERS_CACHE,
      })) as FeatureExtractionPipeline;
      _pipe = p;
      log.info("embed", "local embedding model ready");
      return p;
    } catch (err) {
      log.warn("embed", `local model load failed: ${err}`);
      throw err;
    } finally {
      _loading = null;
    }
  })();
  return _loading;
}

function toFloat32(arr: ArrayLike<number>): Float32Array {
  const out = new Float32Array(arr.length);
  for (let i = 0; i < arr.length; i++) out[i] = arr[i];
  return out;
}

export async function embedBatchLocal(texts: string[]): Promise<Float32Array[]> {
  if (texts.length === 0) return [];
  const pipe = await getPipe();
  const out = await pipe(texts, { pooling: "mean", normalize: true });
  // Output shape: [batch, dim]. The Tensor exposes a flat `data` Float32Array.
  const flat = out.data as Float32Array;
  const batch = texts.length;
  const dim = flat.length / batch;
  // QA5 (R5 finding 6): a wrong dim used to only warn, then proceed to slice
  // with a non-integer/incorrect dim — silently producing misaligned vectors
  // that corrupt every downstream cosine comparison. A dim mismatch means the
  // model loaded wrong; throw so the corpus/dedup layer treats it as an
  // embedding failure (it already degrades to keyword search) rather than
  // trusting garbage similarity.
  if (!Number.isInteger(dim) || dim !== LOCAL_EMBED_DIM) {
    throw new Error(
      `local embedding produced dim ${dim} (expected ${LOCAL_EMBED_DIM}) — model load is corrupt`,
    );
  }
  const result: Float32Array[] = [];
  for (let i = 0; i < batch; i++) {
    const slice = flat.subarray(i * dim, (i + 1) * dim);
    result.push(toFloat32(slice));
  }
  return result;
}

export async function embedOneLocal(text: string): Promise<Float32Array> {
  const [v] = await embedBatchLocal([text]);
  if (!v) throw new Error("embedOneLocal: no vector produced");
  return v;
}
