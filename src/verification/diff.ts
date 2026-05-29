import { runCmd } from "./run";
import type { CheckResult, Plan } from "./types";
import { botConfig } from "../../bot.config";

/** Returns the unified diff text for the worktree vs HEAD. */
export async function getDiffText(cwd: string, baseRef = "HEAD"): Promise<string> {
  const r = await runCmd(["git", "diff", baseRef, "--", "."], cwd);
  return r.stdout;
}

/** Returns the list of changed file paths (added/modified/deleted/renamed). */
export async function getChangedFiles(
  cwd: string,
  baseRef = "HEAD",
): Promise<string[]> {
  const r = await runCmd(["git", "diff", "--name-only", baseRef, "--", "."], cwd);
  return r.stdout
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean);
}

export function checkDiffSize(diffText: string, plan: Plan): CheckResult {
  const lineCount = diffText.split("\n").length;
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
  const missing = expectedTests.filter(
    (p) => !changedFiles.some((c) => c === p || c.endsWith(p)),
  );
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
