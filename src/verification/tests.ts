import { runCmd } from "./run";
import type { CheckResult } from "./types";
import type { ToolchainHints } from "./detect";

export async function checkExistingTests(
  cwd: string,
  hints: ToolchainHints,
): Promise<CheckResult> {
  if (!hints.test) {
    return {
      name: "existing_tests",
      pass: true,
      hardGate: true,
      message: "No test command detected — skipping.",
    };
  }
  const r = await runCmd(hints.test, cwd, 600_000);
  const pass = r.exitCode === 0;
  return {
    name: "existing_tests",
    pass,
    hardGate: true,
    message: pass
      ? "Test suite passed."
      : `Test suite failed (exit ${r.exitCode})`,
    detail: pass
      ? undefined
      : {
          stdoutTail: r.stdout.slice(-4000),
          stderrTail: r.stderr.slice(-2000),
        },
  };
}
