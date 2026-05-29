import fs from "node:fs/promises";
import path from "node:path";

const IGNORE = new Set([
  "node_modules",
  ".next",
  ".git",
  "dist",
  "build",
  "out",
  ".turbo",
  ".vercel",
  "data",
  "coverage",
]);

const LIMIT = 200;

// B6: walk in priority order so we never hit the cap before showing Claude
// the directories that actually matter. `src/`, `app/`, `lib/`, `test/` and
// `tests/` come first; everything else (configs, docs, public assets) only
// fills whatever budget is left.
const PRIORITY_DIRS = ["src", "app", "lib", "test", "tests", "packages"];

class LimitHit extends Error {
  constructor() {
    super("repo summary limit hit");
  }
}

/**
 * Cheap summary of repo layout for the planner prompt. Walks the tree to
 * depth 3, files truncated to 200, prioritized so the planner sees source
 * dirs before docs/configs.
 */
export async function getRepoSummary(repoDir: string): Promise<string> {
  const lines: string[] = [];

  async function walk(dir: string, depth: number) {
    if (depth > 3) return;
    let entries: import("node:fs").Dirent[];
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (IGNORE.has(e.name) || e.name.startsWith(".")) continue;
      const rel = path.relative(repoDir, path.join(dir, e.name));
      if (lines.length >= LIMIT) throw new LimitHit();
      if (e.isDirectory()) {
        lines.push(`${rel}/`);
        await walk(path.join(dir, e.name), depth + 1);
      } else {
        lines.push(rel);
      }
    }
  }

  try {
    // Pass 1: top-level priority dirs first.
    for (const name of PRIORITY_DIRS) {
      const sub = path.join(repoDir, name);
      try {
        const st = await fs.stat(sub);
        if (st.isDirectory()) {
          lines.push(`${name}/`);
          await walk(sub, 1);
        }
      } catch {/* doesn't exist; skip */}
    }
    // Pass 2: everything else at the top level.
    let topEntries: import("node:fs").Dirent[];
    try {
      topEntries = await fs.readdir(repoDir, { withFileTypes: true });
    } catch {
      topEntries = [];
    }
    for (const e of topEntries) {
      if (IGNORE.has(e.name) || e.name.startsWith(".")) continue;
      if (PRIORITY_DIRS.includes(e.name)) continue;
      const rel = path.relative(repoDir, path.join(repoDir, e.name));
      if (lines.length >= LIMIT) throw new LimitHit();
      if (e.isDirectory()) {
        lines.push(`${rel}/`);
        await walk(path.join(repoDir, e.name), 1);
      } else {
        lines.push(rel);
      }
    }
  } catch (err) {
    if (!(err instanceof LimitHit)) throw err;
  }

  // Stable order within each prefix group makes diffs across runs clean.
  return lines.sort().join("\n");
}
