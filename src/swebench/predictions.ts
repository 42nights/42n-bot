import fs from "node:fs";
import type { Prediction } from "./types";

/**
 * Load instance_ids already in the predictions file for resume support.
 * Tolerates a trailing partial line (skip unparseable last line).
 */
export function loadExistingPredictions(outPath: string): Set<string> {
  const ids = new Set<string>();
  if (!fs.existsSync(outPath)) return ids;

  const raw = fs.readFileSync(outPath, "utf8");
  const lines = raw.split("\n").filter((l) => l.trim().length > 0);

  for (const line of lines) {
    try {
      const p = JSON.parse(line) as { instance_id?: unknown };
      if (typeof p.instance_id === "string") {
        ids.add(p.instance_id);
      }
    } catch {
      // Tolerate a trailing partial line.
    }
  }

  return ids;
}

/**
 * Atomically append one prediction line to the JSONL file.
 * Using the 'a' flag ensures crash-safety: a partial write at the very end
 * leaves at most one unparseable line which loadExistingPredictions skips.
 */
export function appendPrediction(outPath: string, pred: Prediction): void {
  const line = JSON.stringify(pred) + "\n";
  fs.writeFileSync(outPath, line, { flag: "a", encoding: "utf8" });
}
