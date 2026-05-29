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

/**
 * Cheap summary of repo layout for the planner prompt. Walks the tree to
 * depth 3, lists files (truncated to 200), groups by top-level dir.
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
      if (e.isDirectory()) {
        lines.push(`${rel}/`);
        if (lines.length > 200) return;
        await walk(path.join(dir, e.name), depth + 1);
      } else {
        lines.push(rel);
        if (lines.length > 200) return;
      }
    }
  }
  await walk(repoDir, 0);
  return lines.sort().join("\n");
}
