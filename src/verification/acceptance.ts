import fs from "node:fs/promises";
import fsSync from "node:fs";
import path from "node:path";
import type { CheckResult } from "./types";
import type { ToolchainHints } from "./detect";
import { runCmd } from "./run";

/** Run the acceptance test files and hard-gate on pass/fail. */
export async function checkAcceptanceTests(
  cwd: string,
  hints: ToolchainHints,
  acceptancePaths: string[],
): Promise<CheckResult> {
  try {
    if (acceptancePaths.length === 0) {
      return {
        name: "acceptance_tests",
        pass: false,
        hardGate: true,
        message:
          "Plan must declare at least one acceptance test path (acceptance_test_paths). No paths provided.",
      };
    }

    // QA3 (R3 finding 17): validate every declared path exists on disk BEFORE
    // running. A path mismatch (plan declared src/x.test.ts, impl wrote it at
    // tests/x.test.ts) would otherwise let a test runner pass on the files it
    // CAN find while the critic silently reads "(could not read file)"
    // placeholders. Fail closed: a declared acceptance test that isn't on disk
    // is a real defect.
    const missing = acceptancePaths.filter((p) => {
      const abs = path.isAbsolute(p) ? p : path.join(cwd, p);
      return !fsSync.existsSync(abs);
    });
    if (missing.length > 0) {
      return {
        name: "acceptance_tests",
        pass: false,
        hardGate: true,
        message: `Declared acceptance test file(s) not found on disk: ${missing.join(", ")}. The plan named tests that the implementation didn't create at those paths.`,
        detail: { missing },
      };
    }

    const argv = hints.testFilesArgv
      ? hints.testFilesArgv(acceptancePaths)
      : hints.test
        ? [...hints.test, ...acceptancePaths]
        : null;

    if (!argv) {
      return {
        name: "acceptance_tests",
        pass: false,
        hardGate: true,
        message:
          "Could not determine test command for this toolchain. detectToolchain returned no test runner.",
      };
    }

    const r = await runCmd(argv, cwd, 600_000);

    if (r.exitCode === 0) {
      return {
        name: "acceptance_tests",
        pass: true,
        hardGate: true,
        message: `Acceptance tests passed (${r.durationMs}ms).`,
      };
    }

    return {
      name: "acceptance_tests",
      pass: false,
      hardGate: true,
      message: `Acceptance tests failed (exit ${r.exitCode}${r.timedOut ? ", timed out" : ""}).`,
      detail: {
        stdoutTail: r.stdout.slice(-3000),
        stderrTail: r.stderr.slice(-2000),
      },
    };
  } catch (err) {
    return {
      name: "acceptance_tests",
      pass: false,
      hardGate: true,
      message: `Acceptance test runner threw unexpectedly: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

/** Concatenate test file contents for the critic to read. */
export async function readTestCode(
  cwd: string,
  paths: string[],
): Promise<string> {
  const parts: string[] = [];
  for (const p of paths) {
    const abs = p.startsWith("/") ? p : `${cwd}/${p}`;
    try {
      const content = await fs.readFile(abs, "utf8");
      parts.push(`// --- ${p} ---\n${content}`);
    } catch {
      parts.push(`// --- ${p} --- (could not read file)`);
    }
  }
  return parts.join("\n\n");
}
