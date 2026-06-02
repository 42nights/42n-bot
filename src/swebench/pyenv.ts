import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

/**
 * Provision a Python venv in the worktree and install the package in editable
 * mode. Returns the path prefix to prepend to PATH so that runCmd's bare
 * `pytest`/`mypy` invocations resolve against the venv.
 *
 * When `noVenv` is true (VM mode, env pre-built on PATH) this is a no-op and
 * returns null.
 *
 * Call provisionPythonEnv before runVerification. Then inject the returned
 * prefix into process.env.PATH for the duration of the instance run:
 *   if (pathPrefix) process.env.PATH = `${pathPrefix}:${process.env.PATH}`;
 * Note: process.env.PATH mutation is global — concurrent workers must restore
 * or avoid it. The harness runs one instance per task in its own async turn,
 * so sequential PATH mutations are safe at concurrency ≤ 1 for venv mode.
 * For higher concurrency with noVenv=false, use a per-process worker.
 */
export async function provisionPythonEnv(
  worktreePath: string,
  noVenv: boolean,
): Promise<string | null> {
  if (noVenv) return null;

  const venvDir = path.join(worktreePath, ".venv");

  if (!fs.existsSync(venvDir)) {
    process.stderr.write(`Creating venv at ${venvDir}\n`);
    execSync(`python3 -m venv ${venvDir}`, {
      cwd: worktreePath,
      stdio: ["ignore", "ignore", "pipe"],
    });
  }

  const pythonBin = path.join(venvDir, "bin");

  // Install the package in editable mode. Try common extras for test deps.
  const pip = path.join(pythonBin, "pip");
  try {
    execSync(`${pip} install --quiet -e ".[test]"`, {
      cwd: worktreePath,
      stdio: ["ignore", "ignore", "pipe"],
      timeout: 120_000,
    });
  } catch {
    // Fallback: bare editable install without test extras.
    try {
      execSync(`${pip} install --quiet -e .`, {
        cwd: worktreePath,
        stdio: ["ignore", "ignore", "pipe"],
        timeout: 120_000,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      process.stderr.write(`pip install failed (continuing anyway): ${msg}\n`);
    }
  }

  // Ensure a test runner exists. `pip install -e .` installs the package and
  // its runtime deps but usually NOT pytest, so Otis's REPRODUCE/existing_tests
  // phases would hit `pytest: command not found` and fly blind. Best-effort.
  // (On the VM full run this is a no-op — the SWE-bench image already has it.)
  try {
    execSync(`${pip} install --quiet pytest`, {
      cwd: worktreePath,
      stdio: ["ignore", "ignore", "pipe"],
      timeout: 120_000,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    process.stderr.write(`pytest install failed (continuing anyway): ${msg}\n`);
  }

  return pythonBin;
}
