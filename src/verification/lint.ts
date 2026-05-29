import { runCmd } from "./run";
import type { CheckResult } from "./types";
import type { ToolchainHints } from "./detect";

export async function checkLint(
  cwd: string,
  hints: ToolchainHints,
): Promise<CheckResult> {
  if (!hints.lint) {
    return {
      name: "lint",
      pass: true,
      hardGate: false,
      message: "No lint command — skipped.",
    };
  }
  const r = await runCmd(hints.lint, cwd);
  const pass = r.exitCode === 0;
  return {
    name: "lint",
    pass,
    hardGate: false,
    message: pass ? "Lint clean." : `Lint warnings/errors (exit ${r.exitCode}).`,
    detail: pass ? undefined : { stdoutTail: r.stdout.slice(-2000) },
  };
}
