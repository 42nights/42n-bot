import { execa, type ResultPromise } from "execa";
import { z } from "zod";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { botConfig } from "../../bot.config";
import { emitEvent } from "../shared/events";
import { log } from "../shared/logger";
import { consumeStreamLine, emptySink, evaluateHang } from "./stream";

/**
 * Strip ANTHROPIC_API_KEY / ANTHROPIC_AUTH_TOKEN before spawning so the CLI
 * uses its keychain OAuth login. Set USE_ANTHROPIC_API_KEY=1 to opt out.
 */
function spawnEnv(): NodeJS.ProcessEnv {
  if (process.env.USE_ANTHROPIC_API_KEY === "1") return process.env;
  const out = { ...process.env };
  delete out.ANTHROPIC_API_KEY;
  delete out.ANTHROPIC_AUTH_TOKEN;
  return out;
}

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

  const args: string[] = ["-p", opts.prompt];
  args.push("--output-format", "stream-json", "--verbose", "--include-partial-messages");
  args.push("--allowedTools", opts.allowedTools.join(","));
  if (opts.permissionMode) args.push("--permission-mode", opts.permissionMode);
  if (opts.systemPromptAppendFile)
    args.push("--append-system-prompt-file", opts.systemPromptAppendFile);
  if (opts.resumeSessionId) args.push("--resume", opts.resumeSessionId);

  // A7: parse stream-json via the shared, testable helper. The sink owns all
  // mutable parse state; runner.ts only enforces lifecycle + budget + hang.
  const sink = emptySink(startedAt);
  let killReason:
    | null
    | "budget_exceeded"
    | "hang_no_tool_use"
    | "hang_no_event"
    | "api_retry_storm" = null;

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
      env: spawnEnv(),
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

  // Hang-killer: 10s tick checks budget + the three heuristics from
  // stream.ts/evaluateHang. Pure function, easy to test.
  const hangTimer = setInterval(() => {
    if (
      opts.costBudgetUsd != null &&
      sink.totalCostUsd > opts.costBudgetUsd &&
      killReason == null
    ) {
      killReason = "budget_exceeded";
      emitEvent(opts.runId, "claude.budget_exceeded", {
        costUsd: sink.totalCostUsd,
        budgetUsd: opts.costBudgetUsd,
      });
      child.kill("SIGKILL");
      return;
    }
    const hang = evaluateHang(sink, startedAt);
    if (!hang.ok && killReason == null) {
      killReason = hang.kind;
      child.kill("SIGKILL");
    }
  }, 10_000);

  let buf = "";
  let lastToolEmitted = 0;
  child.stdout?.on("data", async (chunk: Buffer | string) => {
    const text = typeof chunk === "string" ? chunk : chunk.toString("utf8");
    await stdoutFh.write(text);
    buf += text;
    let nl: number;
    while ((nl = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, nl);
      buf = buf.slice(nl + 1);
      consumeStreamLine(line, sink);
      // Emit a dashboard-visible event whenever we observe a new tool_use —
      // but throttle by comparing against the last emission timestamp so a
      // burst of content_block_starts doesn't flood the events table.
      if (sink.lastToolUseAt > lastToolEmitted) {
        lastToolEmitted = sink.lastToolUseAt;
        emitEvent(opts.runId, "implement.tool_use", {
          mode: opts.mode,
          tool: sink.lastToolName ?? "unknown",
        });
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
      costUsd: sink.totalCostUsd,
    });
    return {
      ok: true,
      mode: opts.mode,
      sessionId: sink.sessionId ?? "",
      result: sink.lastTextResult,
      structuredOutput: sink.structuredOutput,
      costUsd: sink.totalCostUsd,
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
      costUsd: sink.totalCostUsd,
    });

    log.warn(
      "claude",
      `subprocess exit kind=${errorKind} cost=$${sink.totalCostUsd.toFixed(4)}`,
    );

    return {
      ok: false,
      mode: opts.mode,
      sessionId: sink.sessionId,
      errorKind,
      errorMessage,
      partialResult: sink.lastTextResult,
      partialCostUsd: sink.totalCostUsd,
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

  /** Single planner invocation. Captured here so we can retry it cheaply. */
  async function attempt(): Promise<
    | { ok: true; plan: T; costUsd: number; sessionId: string }
    | {
        ok: false;
        error: string;
        partialCostUsd?: number;
        violation?: boolean;
      }
  > {
    try {
      const { stdout } = await execa(botConfig.claudeCode.bin, args, {
        cwd: opts.cwd,
        timeout: opts.timeoutMs ?? botConfig.claudeCode.plannerTimeoutMs,
        maxBuffer: 10 * 1024 * 1024,
        env: spawnEnv(),
      });
      const parsed = ClaudeJsonResultSchema.parse(JSON.parse(stdout));
      const candidate = parsed.structured_output ?? parsed.result;
      const planResult = opts.schema.safeParse(candidate);
      if (!planResult.success) {
        return {
          ok: false,
          violation: true,
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

  // B8: schema violations are usually transient — Claude's JSON-schema mode
  // occasionally glitches and returns text where structured_output should
  // have been. One cheap retry usually recovers.
  const first = await attempt();
  if (first.ok) return first;
  if (!first.violation)
    return {
      ok: false,
      error: first.error,
      partialCostUsd: first.partialCostUsd,
    };

  log.warn(
    "claude",
    `planner schema violation on first attempt; retrying once`,
  );
  const second = await attempt();
  if (second.ok) {
    return {
      ...second,
      costUsd: second.costUsd + (first.partialCostUsd ?? 0),
    };
  }
  return {
    ok: false,
    error: `retry after schema violation: ${second.error}`,
    partialCostUsd:
      (first.partialCostUsd ?? 0) + (second.partialCostUsd ?? 0),
  };
}
