import { getDiffText } from "../verification/diff";
import { DEFAULT_STRIP_PATTERNS } from "./config";

type DiffBlock = {
  path: string;
  lines: string[];
};

/**
 * Parse a unified diff string into per-file blocks. Each block starts at a
 * "diff --git" header line and ends just before the next one (or at EOF).
 */
function parseBlocks(raw: string): DiffBlock[] {
  const lines = raw.split("\n");
  const blocks: DiffBlock[] = [];
  let current: DiffBlock | null = null;

  for (const line of lines) {
    if (line.startsWith("diff --git ")) {
      if (current) blocks.push(current);
      current = { path: parseBPath(line), lines: [line] };
    } else if (current) {
      current.lines.push(line);
    }
  }
  if (current) blocks.push(current);

  return blocks;
}

/**
 * Extract the b/ path from a "diff --git a/<src> b/<dst>" header. Falls back
 * to the a/ path if the regex doesn't match the expected shape.
 */
function parseBPath(header: string): string {
  const m = /^diff --git a\/(.+?) b\/(.+)$/.exec(header);
  if (!m) return header;
  return m[2] ?? m[1];
}

function isTestPath(filePath: string, patterns: RegExp[]): boolean {
  return patterns.some((rx) => rx.test(filePath));
}

/**
 * Capture the model's patch vs base_commit and strip test-file hunks so the
 * result is source-only.
 *
 * Drops whole "diff --git" blocks whose b/ path matches a strip pattern.
 * Keeping block-level (not line-level) means every surviving block is
 * internally consistent — no malformed @@ offsets when swebench git-applies it.
 *
 * Returns the stripped unified diff string, or "" if nothing remains.
 */
export async function captureModelPatch(
  worktreePath: string,
  baseCommit: string,
  stripPatterns: RegExp[] = DEFAULT_STRIP_PATTERNS,
): Promise<string> {
  const raw = await getDiffText(worktreePath, baseCommit);
  if (!raw.trim()) return "";

  const blocks = parseBlocks(raw);
  const kept = blocks.filter((b) => !isTestPath(b.path, stripPatterns));

  if (kept.length === 0) return "";

  // Rejoin blocks, trailing newline so `git apply` is happy.
  const out = kept.map((b) => b.lines.join("\n")).join("\n");
  return out.replace(/\n*$/, "\n");
}
