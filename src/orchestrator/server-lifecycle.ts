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

export async function startDevServer(args: {
  cwd: string;
  command: string;
  port: number;
  readyTimeoutMs?: number;
  env?: Record<string, string>;
}): Promise<StartResult> {
  const { cwd, command, port, readyTimeoutMs = 60_000, env = {} } = args;

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
