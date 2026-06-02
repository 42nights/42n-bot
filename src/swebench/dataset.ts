import fs from "node:fs";
import path from "node:path";
import type { SwebenchInstance } from "./types";
import { HF_DATASETS_BASE, DEFAULTS } from "./config";

type LoadOpts = {
  dataset?: string;
  split?: string;
  cacheDir?: string;
  noCache?: boolean;
  pageSize?: number;
  maxOffset?: number;
};

/** One entry in the HF datasets-server .rows array. */
type HFRow = { row: Record<string, unknown> };

/**
 * Paginate the HuggingFace datasets-server REST API and return all rows.
 * Results are cached to disk per (dataset, split) pair.
 *
 * Uses global fetch (Node 18+/tsx). No Python, no 'datasets' library.
 */
export async function loadInstances(opts: LoadOpts = {}): Promise<SwebenchInstance[]> {
  const dataset = opts.dataset ?? DEFAULTS.dataset;
  const split = opts.split ?? DEFAULTS.split;
  const cacheDir = opts.cacheDir ?? DEFAULTS.cacheDir;
  const pageSize = opts.pageSize ?? DEFAULTS.pageSize;
  const maxOffset = opts.maxOffset ?? DEFAULTS.maxOffset;

  const cacheFile = path.join(
    cacheDir,
    `${dataset.replace(/\//g, "__")}__${split}.json`,
  );

  if (!opts.noCache && fs.existsSync(cacheFile)) {
    const raw = fs.readFileSync(cacheFile, "utf8");
    return JSON.parse(raw) as SwebenchInstance[];
  }

  if (!fs.existsSync(cacheDir)) {
    fs.mkdirSync(cacheDir, { recursive: true });
  }

  const rows: SwebenchInstance[] = [];
  const enc = encodeURIComponent;

  for (let offset = 0; offset <= maxOffset; offset += pageSize) {
    const url =
      `${HF_DATASETS_BASE}?dataset=${enc(dataset)}&config=default` +
      `&split=${enc(split)}&offset=${offset}&length=${pageSize}`;

    let body: { rows?: HFRow[] };
    let attempt = 0;
    while (true) {
      attempt++;
      const resp = await fetch(url);
      if (resp.ok) {
        body = (await resp.json()) as { rows?: HFRow[] };
        break;
      }
      if (attempt >= 3) {
        throw new Error(
          `HF datasets-server fetch failed after ${attempt} attempts: ` +
            `${resp.status} ${resp.statusText} (${url})`,
        );
      }
      const backoffMs = attempt * 2000;
      process.stderr.write(
        `HF fetch ${resp.status} — retrying in ${backoffMs}ms (attempt ${attempt}/3)\n`,
      );
      await new Promise((r) => setTimeout(r, backoffMs));
    }

    const page = (body.rows ?? []).map((r) => r.row as unknown as SwebenchInstance);
    rows.push(...page);
    process.stderr.write(
      `Loaded ${rows.length} instances (offset=${offset})\n`,
    );
    if (page.length < pageSize) break;
  }

  fs.writeFileSync(cacheFile, JSON.stringify(rows, null, 2));
  process.stderr.write(`Cached ${rows.length} instances to ${cacheFile}\n`);

  return rows;
}
