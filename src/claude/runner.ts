import { execa, type ResultPromise } from "execa";
import { z } from "zod";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { botConfig } from "../../bot.config";
import { emitEvent } from "../shared/events";
import { log } from "../shared/logger";

export type ClaudeRunMode = "plan" | "implement" | "critic" | "review";

export type ClaudeRunOptions = {
  runId: number;
  mode: ClaudeRunMode;
  prompt: string;
  cwd: string;
  systemPromptAppendFile?: string;
  allowedTools: string[];
  permissionMode?: "acceptEdits" | "dontAsk";
  resumeSessionId?: string;
  timeoutMs?: number;
  costBudgetUsd?: number;
};

export type ClaudeRunResult =
  | {
      ok: true;
      mode: ClaudeRunMode;
      sessionId: string;
      result?: string;
      structuredOutput?: unknown;
      costUsd: number;
      durationMs: number;
      stdoutPath: string;
      stderrPath: string;
    }
  | {
      ok: false;
      mode: ClaudeRunMode;
      sessionId?: string;
      errorKind:
        | "timeout"
        | "spawn_failed"
        | "non_zero_exit"
        | "stdin_too_large"
        | "schema_violation"
        | "budget_exceeded"
        | "hang_no_tool_use"
        | "hang_no_event"
        | "api_retry_storm"
        | "unknown";
      errorMessage: string;
      partialResult?: string;
      partialCostUsd?: number;
      durationMs: number;
      stdoutPath?: string;
      stderrPath?: string;
    };

const ClaudeJsonResultSchema = z
  .object({
    result: z.string().optional(),
    structured_output: z.unknown().optional(),
    session_id: z.string().optional(),
    total_cost_usd: z.number().optional(),
  })
  .passthrough();

/**
 * Spawn a Claude Code subprocess with bot-safe defaults and stream-json
 * parsing. The wrapper owns:
 *  - process lifecycle + hard SIGKILL on timeout
 *  - cost capture from the `result` event (`total_cost_usd`)
 *  - hang heuristics (§16.5 of the spec)
 *  - structured error categorization
 *  - persistent transcripts on disk for post-hoc debugging
 *  - event emission into the runs/events table for live dashboard
 */
export async function runClaudeCode(opts: ClaudeRunOptions): Promise<ClaudeRunResult> {
  const startedAt = Date.now();
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), `42n-claude-${opts.mode}-`));
  const stdoutPath = path.join(tmpDir, "stdout.ndjson");
  const stderrPath = path.join(tmpDir, "stderr.log");

  const args: string[] = ["-p", opts.prompt, "--bare"];
  args.push("--output-format", "stream-json", "--verbose", "--include-partial-messages");
  args.push("--allowedTools", opts.allowedTools.join(","));
  if (opts.permissionMode) args.push("--permission-mode", opts.permissionMode);
  if (opts.systemPromptAppendFile)
    args.push("--append-system-prompt-file", opts.systemPromptAppendFile);
  if (opts.resumeSessionId) args.push("--resume", opts.resumeSessionId);

  let sessionId: string | undefined;
  let totalCostUsd = 0;
  let lastTextResult: string | undefined;
  let structuredOutput: unknown;
  let killReason:
    | null
    | "budget_exceeded"
    | "hang_no_tool_use"
    | "hang_no_event"
    | "api_retry_storm" = null;
  let lastToolUseAt = Date.now();
  let lastAnyEventAt = Date.now();
  let lastTextDeltaAt = 0;
  let apiRetryAttempts = 0;

  let child: ResultPromise<{
    cwd: string;
    timeout: number;
    killSignal: NodeJS.Signals;
    env: NodeJS.ProcessEnv;
    encoding: "utf8";
    maxBuffer: number;
  }>;
  try {
    child = execa(botConfig.claudeCode.bin, args, {
      cwd: opts.cwd,
      timeout: opts.timeoutMs ?? botConfig.claudeCode.defaultTimeoutMs,
      killSignal: "SIGKILL",
      env: {
        ...process.env,
        ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY ?? "",
      },
      encoding: "utf8",
      maxBuffer: 100 * 1024 * 1024,
    });
  } catch (err) {
    return {
      ok: false,
      mode: opts.mode,
      errorKind: "spawn_failed",
      errorMessage: err instanceof Error ? err.message : String(err),
      durationMs: Date.now() - startedAt,
    };
  }

  emitEvent(opts.runId, "claude.subprocess.spawned", {
    mode: opts.mode,
    pid: child.pid,
    bin: botConfig.claudeCode.bin,
    cwd: opts.cwd,
  });

  const stdoutFh = await fs.open(stdoutPath, "w");
  const stderrFh = await fs.open(stderrPath, "w");

  // Heuristic hang-killer: every 10s, check the timing invariants.
  const hangTimer = setInterval(() => {
    const now = Date.now();
    if (
      opts.costBudgetUsd != null &&
      totalCostUsd > opts.costBudgetUsd &&
      killReason == null
    ) {
      killReason = "budget_exceeded";
      emitEvent(opts.runId, "claude.budget_exceeded", {
        costUsd: totalCostUsd,
        budgetUsd: opts.costBudgetUsd,
      });
      child.kill("SIGKILL");
      return;
    }
    if (
      now - lastAnyEventAt > 60_000 &&
      now - startedAt > 60_000 &&
      killReason == null
    ) {
      killReason = "hang_no_event";
      child.kill("SIGKILL");
      return;
    }
    if (
      lastTextDeltaAt > lastToolUseAt &&
      now - lastToolUseAt > 90_000 &&
      killReason == null
    ) {
      killReason = "hang_no_tool_use";
      child.kill("SIGKILL");
      return;
    }
    if (apiRetryAttempts >= 5 && killReason == null) {
      killReason = "api_retry_storm";
      child.kill("SIGKILL");
    }
  }, 10_000);

  let buf = "";
  child.stdout?.on("data", async (chunk: Buffer | string) => {
    const text = typeof chunk === "string" ? chunk : chunk.toString("utf8");
    await stdoutFh.write(text);
    buf += text;
    lastAnyEventAt = Date.now();
    let nl: number;
    while ((nl = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      if (!line) continue;
      try {
        const evt = JSON.parse(line);
        if (evt.type === "system" && evt.subtype === "init" && evt.session_id) {
          sessionId = evt.session_id;
        }
        if (evt.type === "system" && evt.subtype === "api_retry") {
          apiRetryAttempts = Math.max(apiRetryAttempts, Number(evt.attempt ?? 0));
        }
        if (evt.type === "tool_use" || evt.subtype === "tool_use") {
          lastToolUseAt = Date.now();
          emitEvent(opts.runId, "implement.tool_use", {
            mode: opts.mode,
            tool: evt.tool_name ?? evt.name ?? "unknown",
          });
        }
        if (evt.type === "text_delta" || evt.subtype === "text_delta") {
          lastTextDeltaAt = Date.now();
        }
        if (evt.type === "result") {
          if (typeof evt.total_cost_usd === "number")
            totalCostUsd = evt.total_cost_usd;
          if (typeof evt.result === "string") lastTextResult = evt.result;
          if (evt.structured_output !== undefined)
            structuredOutput = evt.structured_output;
        }
      } catch {
        /* malformed line — non-JSON debug output, ignore */
      }
    }
  });

  child.stderr?.on("data", async (chunk: Buffer | string) => {
    const text = typeof chunk === "string" ? chunk : chunk.toString("utf8");
    await stderrFh.write(text);
  });

  try {
    await child;
    clearInterval(hangTimer);
    await stdoutFh.close();
    await stderrFh.close();
    const durationMs = Date.now() - startedAt;
    emitEvent(opts.runId, "claude.subprocess.exit", {
      mode: opts.mode,
      ok: true,
      durationMs,
      costUsd: totalCostUsd,
    });
    return {
      ok: true,
      mode: opts.mode,
      sessionId: sessionId ?? "",
      result: lastTextResult,
      structuredOutput,
      costUsd: totalCostUsd,
      durationMs,
      stdoutPath,
      stderrPath,
    };
  } catch (err) {
    clearInterval(hangTimer);
    await stdoutFh.close().catch(() => {});
    await stderrFh.close().catch(() => {});
    const durationMs = Date.now() - startedAt;
    const e = err as {
      timedOut?: boolean;
      exitCode?: number;
      shortMessage?: string;
      code?: string;
    };

    let errorKind: Extract<ClaudeRunResult, { ok: false }>["errorKind"] = "unknown";
    if (killReason) errorKind = killReason;
    else if (e.timedOut) errorKind = "timeout";
    else if (e.exitCode != null && e.exitCode !== 0) errorKind = "non_zero_exit";
    else if (e.code === "ENOENT") errorKind = "spawn_failed";

    const errorMessage = e.shortMessage ?? (err instanceof Error ? err.message : String(err));

    emitEvent(opts.runId, "claude.subprocess.exit", {
      mode: opts.mode,
      ok: false,
      durationMs,
      errorKind,
      costUsd: totalCostUsd,
    });

    log.warn("claude", `subprocess exit kind=${errorKind} cost=$${totalCostUsd.toFixed(4)}`);

    return {
      ok: false,
      mode: opts.mode,
      sessionId,
      errorKind,
      errorMessage,
      partialResult: lastTextResult,
      partialCostUsd: totalCostUsd,
      durationMs,
      stdoutPath,
      stderrPath,
    };
  }
}

/**
 * Planner mode: forces the LLM into a JSON-Schema-bound output. Uses
 * `--output-format json --json-schema`, NOT stream-json — the two are
 * mutually exclusive in Claude Code. No streaming, just a single result.
 */
export async function runStructuredPlan<T>(opts: {
  runId: number;
  prompt: string;
  cwd: string;
  schema: z.ZodSchema<T>;
  jsonSchema: object;
  timeoutMs?: number;
  costBudgetUsd?: number;
  appendSystemPromptFile?: string;
}): Promise<
  | { ok: true; plan: T; costUsd: number; sessionId: string }
  | { ok: false; error: string; partialCostUsd?: number }
> {
  const args = [
    "-p",
    opts.prompt,
    "--bare",
    "--output-format",
    "json",
    "--json-schema",
    JSON.stringify(opts.jsonSchema),
    "--allowedTools",
    "Read",
    "--permission-mode",
    "dontAsk",
  ];
  if (opts.appendSystemPromptFile)
    args.push("--append-system-prompt-file", opts.appendSystemPromptFile);

  emitEvent(opts.runId, "claude.subprocess.spawned", {
    mode: "plan",
    structured: true,
  });

  try {
    const { stdout } = await execa(botConfig.claudeCode.bin, args, {
      cwd: opts.cwd,
      timeout: opts.timeoutMs ?? botConfig.claudeCode.plannerTimeoutMs,
      maxBuffer: 10 * 1024 * 1024,
      env: {
        ...process.env,
        ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY ?? "",
      },
    });
    const parsed = ClaudeJsonResultSchema.parse(JSON.parse(stdout));
    const candidate = parsed.structured_output ?? parsed.result;
    const planResult = opts.schema.safeParse(candidate);
    if (!planResult.success) {
      return {
        ok: false,
        error: `schema violation: ${planResult.error.message}`,
        partialCostUsd: parsed.total_cost_usd ?? 0,
      };
    }
    return {
      ok: true,
      plan: planResult.data,
      costUsd: parsed.total_cost_usd ?? 0,
      sessionId: parsed.session_id ?? "",
    };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
