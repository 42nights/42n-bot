import { runCmd } from "./run";
import type { CheckResult } from "./types";
import type { ToolchainHints } from "./detect";

export async function checkTypecheck(
  cwd: string,
  hints: ToolchainHints,
): Promise<CheckResult> {
  if (!hints.typecheck) {
    return {
      name: "typecheck",
      pass: true,
      hardGate: true,
      message: "No typecheck command detected for this repo — skipping.",
    };
  }
  const r = await runCmd(hints.typecheck, cwd);
  const pass = r.exitCode === 0;
  return {
    name: "typecheck",
    pass,
    hardGate: true,
    message: pass
      ? "Typecheck passed."
      : `Typecheck failed (exit ${r.exitCode})`,
    detail: pass
      ? undefined
      : {
          stdoutTail: r.stdout.slice(-2000),
          stderrTail: r.stderr.slice(-2000),
        },
  };
}
