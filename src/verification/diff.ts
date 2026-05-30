import { runCmd } from "./run";
import type { CheckResult, Plan } from "./types";
import { botConfig } from "../../bot.config";

/**
 * Returns the unified diff text for the worktree vs `baseRef`.
 *
 * QA1: `git add --intent-to-add` (`-N`) is run first against any untracked
 * files so they show up in `git diff`. Without this, new files the
 * implementer created (tests, new source files) are invisible to the
 * verification harness — `plan_tests_added` and `diff_size` see only
 * modifications to already-tracked files.
 */
// We symlink node_modules into each worktree (see orchestrator/deps.ts). Most
// repos gitignore it, but not all — exclude it from every diff op explicitly so
// the dependency symlink can never leak into a PR or the diff-size gate.
const EXCLUDE_DEPS = ":(exclude)node_modules";

export async function getDiffText(cwd: string, baseRef = "HEAD"): Promise<string> {
  await intentToAddUntracked(cwd);
  const r = await runCmd(["git", "diff", baseRef, "--", ".", EXCLUDE_DEPS], cwd);
  return r.stdout;
}

/** Returns the list of changed file paths (added/modified/deleted/renamed). */
export async function getChangedFiles(
  cwd: string,
  baseRef = "HEAD",
): Promise<string[]> {
  await intentToAddUntracked(cwd);
  const r = await runCmd(
    ["git", "diff", "--name-only", baseRef, "--", ".", EXCLUDE_DEPS],
    cwd,
  );
  return r.stdout
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * Stage untracked files as "intent to add" so they participate in `git diff`
 * without actually adding their content to the index. Idempotent.
 */
async function intentToAddUntracked(cwd: string): Promise<void> {
  const ls = await runCmd(
    ["git", "ls-files", "--others", "--exclude-standard", "--", ".", EXCLUDE_DEPS],
    cwd,
  );
  const files = ls.stdout
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean);
  if (files.length === 0) return;
  // QA2: chunk to avoid OS ARG_MAX (~256KB on macOS). A target repo with a
  // missing .gitignore can return 50k+ untracked paths. Without chunking the
  // call throws E2BIG and the verification fails with a confusing error.
  const CHUNK = 500;
  for (let i = 0; i < files.length; i += CHUNK) {
    const slice = files.slice(i, i + CHUNK);
    await runCmd(["git", "add", "-N", "--", ...slice], cwd);
  }
}

export function checkDiffSize(diffText: string, plan: Plan): CheckResult {
  // QA5 (R5 finding 9): an empty diff has 0 lines, not 1. `"".split("\n")`
  // yields `[""]` (length 1), so a no-op PR used to report "1 line".
  const lineCount = diffText === "" ? 0 : diffText.split("\n").length;
  const max = botConfig.verification.diffMaxLines;
  // `large` complexity gets twice the budget.
  const effectiveMax = plan.complexity === "large" ? max * 2 : max;
  const pass = lineCount <= effectiveMax;
  return {
    name: "diff_size",
    pass,
    hardGate: false,
    message: pass
      ? `Diff is ${lineCount} lines (cap ${effectiveMax}).`
      : `Diff is ${lineCount} lines — over cap ${effectiveMax}.`,
    detail: { lineCount, cap: effectiveMax, complexity: plan.complexity },
  };
}

export function checkPlanTestsAdded(
  changedFiles: string[],
  plan: Plan,
): CheckResult {
  const expectedTests = plan.tests_to_add_or_update.map((t) => t.path);
  if (expectedTests.length === 0) {
    return {
      name: "plan_tests_added",
      pass: true,
      hardGate: true,
      message: "Plan declared no test changes.",
    };
  }
  // QA1: the previous predicate used `endsWith`, which false-passes when the
  // model writes the test at a different path than the plan declared (e.g.
  // plan said `test/auth.test.ts` but the diff has `some/dir/test/auth.test.ts`).
  // Compare normalized paths exactly, after stripping a leading `./`.
  const norm = (p: string) => p.replace(/^\.\//, "");
  const changedSet = new Set(changedFiles.map(norm));
  const missing = expectedTests.filter((p) => !changedSet.has(norm(p)));
  return {
    name: "plan_tests_added",
    pass: missing.length === 0,
    hardGate: true,
    message:
      missing.length === 0
        ? `All ${expectedTests.length} planned test file(s) are in the diff.`
        : `Missing test files from plan: ${missing.join(", ")}`,
    detail: { expected: expectedTests, missing },
  };
}
