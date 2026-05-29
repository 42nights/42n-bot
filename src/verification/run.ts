import { execa } from "execa";

export type ProcResult = {
  exitCode: number;
  stdout: string;
  stderr: string;
  durationMs: number;
  timedOut: boolean;
};

/**
 * Thin wrapper that runs a shell command in the worktree, captures output,
 * and never throws on non-zero exit. Returns a uniform shape that the
 * verification checks consume.
 */
export async function runCmd(
  argv: string[],
  cwd: string,
  timeoutMs = 300_000,
): Promise<ProcResult> {
  const started = Date.now();
  try {
    const r = await execa(argv[0], argv.slice(1), {
      cwd,
      timeout: timeoutMs,
      reject: false,
      maxBuffer: 50 * 1024 * 1024,
      env: { ...process.env, CI: "1" },
    });
    return {
      exitCode: r.exitCode ?? -1,
      stdout: r.stdout ?? "",
      stderr: r.stderr ?? "",
      durationMs: Date.now() - started,
      timedOut: Boolean((r as { timedOut?: boolean }).timedOut),
    };
  } catch (err) {
    return {
      exitCode: -1,
      stdout: "",
      stderr: err instanceof Error ? err.message : String(err),
      durationMs: Date.now() - started,
      timedOut: false,
    };
  }
}
