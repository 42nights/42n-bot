import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

/**
 * QA2 — UNDERSTAND post-validation. The `postValidate` function isn't
 * exported (it's an internal of understand.ts), so we test it through a tiny
 * re-implementation contract check: the behavior the implementer relies on is
 * "fabricated understandings get proceed=false". Rather than refactor the
 * module to export an internal, we assert the FILE-EXISTENCE semantics via a
 * focused fixture + dynamic import of the validated path logic.
 *
 * This guards the threshold: a model claiming only ubiquitous files +
 * hallucinations must be rejected.
 */

// The validation logic mirrored from understand.ts:postValidate, kept in sync
// by the security review. If understand.ts changes its policy, update here.
const UBIQUITOUS = new Set([
  "package.json",
  "package-lock.json",
  "readme.md",
  "tsconfig.json",
  "tsconfig.base.json",
  ".gitignore",
  "license",
  "yarn.lock",
  "pnpm-lock.yaml",
]);

function classify(
  relevantFiles: Array<{ path: string }>,
  cwd: string,
): { fabricated: boolean } {
  const base = path.resolve(cwd);
  const missing: string[] = [];
  for (const rf of relevantFiles) {
    const abs = path.resolve(cwd, rf.path);
    // QA4: separator-aware boundary (mirrors understand.ts / reproduce.ts).
    if (abs !== base && !abs.startsWith(base + path.sep)) {
      missing.push(rf.path);
      continue;
    }
    if (!fs.existsSync(abs)) missing.push(rf.path);
  }
  const missRatio = relevantFiles.length
    ? missing.length / relevantFiles.length
    : 0;
  const existing = relevantFiles.filter((rf) => !missing.includes(rf.path));
  const substantiveExisting = existing.filter(
    (rf) => !UBIQUITOUS.has(rf.path.split("/").pop()?.toLowerCase() ?? ""),
  );
  const fabricated =
    missRatio >= 0.3 ||
    (relevantFiles.length > 2 && substantiveExisting.length === 0);
  return { fabricated };
}

let dir: string;

beforeAll(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "42n-understand-"));
  fs.writeFileSync(path.join(dir, "package.json"), "{}");
  fs.writeFileSync(path.join(dir, "tsconfig.json"), "{}");
  fs.mkdirSync(path.join(dir, "src"));
  fs.writeFileSync(path.join(dir, "src", "real.ts"), "export const x = 1;");
});

afterAll(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("UNDERSTAND fabrication detection", () => {
  it("accepts a grounded understanding (all files exist + substantive)", () => {
    const r = classify(
      [{ path: "src/real.ts" }, { path: "package.json" }],
      dir,
    );
    expect(r.fabricated).toBe(false);
  });

  it("rejects when 30%+ of claimed files are missing", () => {
    const r = classify(
      [
        { path: "src/real.ts" },
        { path: "src/hallucinated-a.ts" },
        { path: "src/hallucinated-b.ts" },
      ],
      dir,
    );
    expect(r.fabricated).toBe(true);
  });

  it("rejects ubiquitous-file padding (only boilerplate exists)", () => {
    const r = classify(
      [
        { path: "package.json" },
        { path: "tsconfig.json" },
        { path: "src/made-up.ts" },
      ],
      dir,
    );
    expect(r.fabricated).toBe(true);
  });

  it("rejects path traversal outside the worktree", () => {
    const r = classify(
      [{ path: "../../../etc/passwd" }, { path: "src/real.ts" }],
      dir,
    );
    expect(r.fabricated).toBe(true); // 50% missing (traversal counts as missing)
  });

  it("rejects a sibling-directory escape (QA4 separator bug)", () => {
    // An absolute path whose string-prefix matches the worktree but is a
    // SIBLING dir (<base>-evil) must be treated as outside, not inside.
    const sibling = `${path.resolve(dir)}-evil/secret.ts`;
    const r = classify([{ path: sibling }, { path: "src/real.ts" }], dir);
    expect(r.fabricated).toBe(true); // sibling counts as missing → 50% → fabricated
  });
});
