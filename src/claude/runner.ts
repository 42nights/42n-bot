import { execa, type ResultPromise } from "execa";
import { z } from "zod";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { botConfig } from "../../bot.config";
import { emitEvent } from "../shared/events";
import { log } from "../shared/logger";
import { claudeSpawnEnv } from "../shared/spawn-env";
import { consumeStreamLine, emptySink, evaluateHang } from "./stream";

export type ClaudeRunMode = "plan" | "implement" | "critic" | "review";

export type ClaudeRunOptions = {
  runId: string;
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
 * QA3 (R3 finding 13): pull `total_cost_usd` out of raw CLI stdout with a
 * regex when the JSON didn't parse. Best-effort — returns 0 if not found.
 */
function scrapeCostFromStdout(stdout: string): number {
  const m = stdout.match(
    /"total_cost_usd"\s*:\s*(-?(?:[0-9]+(?:\.[0-9]+)?|\.[0-9]+)(?:[eE][+-]?[0-9]+)?)/,
  );
  if (!m) return 0;
  const v = Number(m[1]);
  return Number.isFinite(v) ? v : 0;
}

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
      env: claudeSpawnEnv(),
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
  const consume = (line: string) => {
    consumeStreamLine(line, sink);
    // Emit a dashboard-visible event whenever we observe a new tool_use —
    // but throttle by comparing against the last emission timestamp so a
    // burst of content_block_starts doesn't flood the events table.
    if (sink.lastToolUseAt > lastToolEmitted) {
      lastToolEmitted = sink.lastToolUseAt;
      emitEvent(opts.runId, "implement.tool_use", {
        mode: opts.mode,
        tool: sink.lastToolName ?? "unknown",
        // `input` may be undefined when the tool_use first arrived via a
        // partial content_block_start (before the assistant turn-boundary).
        // The narration translator falls back gracefully when it's missing.
        input: sink.lastToolInput,
      });
    }
  };
  child.stdout?.on("data", async (chunk: Buffer | string) => {
    // QA3 (R3 finding 19): wrap the file write so a disk-full / closed-handle
    // rejection doesn't become an unhandled promise rejection that crashes
    // the process. Parsing continues regardless — the transcript file is a
    // debugging convenience, not load-bearing.
    try {
      const text = typeof chunk === "string" ? chunk : chunk.toString("utf8");
      await stdoutFh.write(text);
      buf += text;
      let nl: number;
      while ((nl = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, nl);
        buf = buf.slice(nl + 1);
        consume(line);
      }
    } catch (err) {
      log.warn("claude", `stdout handler error: ${err}`);
    }
  });

  // QA3 (R3 finding 11): the CLI's final stdout line may not be newline-
  // terminated. Process whatever remains in `buf` on stream end, or the
  // `result` event (cost + final text) can be silently dropped.
  child.stdout?.on("end", () => {
    if (buf.trim()) {
      try {
        consume(buf);
      } catch {
        /* ignore parse errors on the tail */
      }
      buf = "";
    }
  });

  child.stderr?.on("data", async (chunk: Buffer | string) => {
    try {
      const text = typeof chunk === "string" ? chunk : chunk.toString("utf8");
      await stderrFh.write(text);
    } catch (err) {
      log.warn("claude", `stderr handler error: ${err}`);
    }
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
  runId: string;
  prompt: string;
  cwd: string;
  schema: z.ZodSchema<T>;
  jsonSchema: object;
  timeoutMs?: number;
  costBudgetUsd?: number;
  appendSystemPromptFile?: string;
  allowedTools?: string[];
  permissionMode?: "acceptEdits" | "dontAsk";
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
    (opts.allowedTools ?? ["Read"]).join(","),
    "--permission-mode",
    opts.permissionMode ?? "dontAsk",
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
    let rawStdout = "";
    try {
      const { stdout } = await execa(botConfig.claudeCode.bin, args, {
        cwd: opts.cwd,
        timeout: opts.timeoutMs ?? botConfig.claudeCode.plannerTimeoutMs,
        maxBuffer: 10 * 1024 * 1024,
        env: claudeSpawnEnv(),
      });
      rawStdout = stdout;
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
      // QA3 (R3 finding 13): the model already cost tokens even when its
      // output won't JSON.parse. Best-effort scrape the cost out of the raw
      // stdout so the run's budget accounting isn't silently $0.
      return {
        ok: false,
        error: err instanceof Error ? err.message : String(err),
        partialCostUsd: scrapeCostFromStdout(rawStdout),
      };
    }
  }

  // B8: schema violations are usually transient — Claude's JSON-schema mode
  // occasionally glitches and returns text where structured_output should
  // have been. One cheap retry usually recovers.
  const first = await attempt();
  if (first.ok) {
    if (opts.costBudgetUsd != null && first.costUsd > opts.costBudgetUsd) {
      log.warn(
        "claude",
        `planner budget overrun: cost=$${first.costUsd.toFixed(4)} budget=$${opts.costBudgetUsd.toFixed(4)}`,
      );
    }
    return first;
  }
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
    const totalCost = second.costUsd + (first.partialCostUsd ?? 0);
    if (opts.costBudgetUsd != null && totalCost > opts.costBudgetUsd) {
      log.warn(
        "claude",
        `planner budget overrun: cost=$${totalCost.toFixed(4)} budget=$${opts.costBudgetUsd.toFixed(4)}`,
      );
    }
    return {
      ...second,
      costUsd: totalCost,
    };
  }
  return {
    ok: false,
    error: `retry after schema violation: ${second.error}`,
    partialCostUsd:
      (first.partialCostUsd ?? 0) + (second.partialCostUsd ?? 0),
  };
}
