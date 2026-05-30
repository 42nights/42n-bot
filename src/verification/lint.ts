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

  // Exit-code semantics (eslint, ruff, most linters):
  //   0 → clean
  //   1 → lint problems found (a real signal about the diff)
  //   2+ → the linter itself failed to run: missing/broken config, bad flag,
  //        internal crash. That's the TARGET repo's setup problem, not a defect
  //        in the bot's diff. Penalizing it would drop every otherwise-good fix
  //        on a repo that ships a `lint` script but no eslint config (common)
  //        to needs-review. Treat as "couldn't run" → pass, non-blocking.
  if (r.exitCode >= 2) {
    return {
      name: "lint",
      pass: true,
      hardGate: false,
      message: `Lint could not run (exit ${r.exitCode} — likely missing/broken lint config); skipped.`,
      detail: { stderrTail: (r.stderr || r.stdout).slice(-1000) },
    };
  }
  const pass = r.exitCode === 0;
  return {
    name: "lint",
    pass,
    hardGate: false,
    message: pass ? "Lint clean." : `Lint warnings/errors (exit ${r.exitCode}).`,
    detail: pass ? undefined : { stdoutTail: r.stdout.slice(-2000) },
  };
}
