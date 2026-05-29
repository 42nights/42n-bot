/**
 * Stream-JSON event parsing for Claude Code (`-p --output-format stream-json
 * --verbose --include-partial-messages`). Extracted from runner.ts so we can
 * unit-test against captured ndjson fixtures without spawning a subprocess.
 *
 * The Claude Code event taxonomy (verified against docs + real captures):
 *
 *   { "type": "system", "subtype": "init", "session_id": "..." }
 *   { "type": "system", "subtype": "api_retry", "attempt": N }
 *
 *   { "type": "assistant", "message": { "content": [ … ] } }    // turn boundary
 *   { "type": "user",      "message": { "content": [ … ] } }    // tool_result/user turn
 *
 *   // partial-message stream_event wrappers (with --include-partial-messages)
 *   { "type": "stream_event",
 *     "event": {
 *       "type": "content_block_start",
 *       "content_block": { "type": "tool_use" | "text", "name"?: "..." } } }
 *   { "type": "stream_event",
 *     "event": {
 *       "type": "content_block_delta",
 *       "delta": { "type": "text_delta" | "input_json_delta" } } }
 *
 *   { "type": "result",
 *     "result": "...", "structured_output"?: …,
 *     "total_cost_usd": 0.0123, "session_id": "..." }
 *
 * Tool use can also surface inside an `assistant` event's content[] as
 * `{ "type": "tool_use", "name": "Bash" }`. We honor both shapes.
 */

export type StreamEvent = Record<string, unknown> & { type?: unknown };

export type StreamSink = {
  sessionId?: string;
  totalCostUsd: number;
  lastTextResult?: string;
  structuredOutput?: unknown;
  apiRetryAttempts: number;
  lastAnyEventAt: number;
  lastToolUseAt: number;
  lastTextDeltaAt: number;
  lastToolName?: string;
};

export function emptySink(now = Date.now()): StreamSink {
  return {
    totalCostUsd: 0,
    apiRetryAttempts: 0,
    lastAnyEventAt: now,
    lastToolUseAt: now,
    lastTextDeltaAt: 0,
  };
}

/**
 * Parse one ndjson line and update the sink in place. Returns `true` if the
 * line moved any state (useful for tests + activity-based hang detection).
 * Bad JSON is silently dropped — Claude Code occasionally emits a banner or
 * a warning line that isn't valid JSON.
 */
export function consumeStreamLine(line: string, sink: StreamSink, now = Date.now()): boolean {
  const trimmed = line.trim();
  if (!trimmed) return false;
  let evt: StreamEvent;
  try {
    evt = JSON.parse(trimmed);
  } catch {
    return false;
  }
  sink.lastAnyEventAt = now;
  const type = evt.type;

  if (type === "system") {
    const sub = (evt as { subtype?: unknown }).subtype;
    if (sub === "init" && typeof (evt as { session_id?: unknown }).session_id === "string") {
      sink.sessionId = (evt as { session_id: string }).session_id;
    }
    if (sub === "api_retry") {
      const attempt = Number((evt as { attempt?: unknown }).attempt ?? 0);
      sink.apiRetryAttempts = Math.max(sink.apiRetryAttempts, attempt);
    }
    return true;
  }

  if (type === "result") {
    const cost = (evt as { total_cost_usd?: unknown }).total_cost_usd;
    if (typeof cost === "number") sink.totalCostUsd = cost;
    const result = (evt as { result?: unknown }).result;
    if (typeof result === "string") sink.lastTextResult = result;
    if ("structured_output" in evt) {
      sink.structuredOutput = (evt as { structured_output: unknown }).structured_output;
    }
    if (typeof (evt as { session_id?: unknown }).session_id === "string") {
      sink.sessionId = (evt as { session_id: string }).session_id;
    }
    return true;
  }

  // Partial-message stream wrapper.
  if (type === "stream_event") {
    const inner = (evt as { event?: Record<string, unknown> }).event ?? {};
    const innerType = inner.type;
    if (innerType === "content_block_start") {
      const block = (inner as { content_block?: { type?: unknown; name?: unknown } })
        .content_block;
      if (block?.type === "tool_use") {
        sink.lastToolUseAt = now;
        if (typeof block.name === "string") sink.lastToolName = block.name;
      }
    } else if (innerType === "content_block_delta") {
      const delta = (inner as { delta?: { type?: unknown } }).delta;
      if (delta?.type === "text_delta") sink.lastTextDeltaAt = now;
    }
    return true;
  }

  // Turn-boundary events from the non-partial stream — also progress evidence.
  if (type === "assistant" || type === "user") {
    // Some captures put tool_use blocks directly here.
    const msg = (evt as { message?: { content?: unknown } }).message;
    const content = Array.isArray(msg?.content) ? msg.content : [];
    for (const block of content) {
      const b = block as { type?: unknown; name?: unknown };
      if (b?.type === "tool_use") {
        sink.lastToolUseAt = now;
        if (typeof b.name === "string") sink.lastToolName = b.name;
      }
    }
    return true;
  }

  return true;
}

export type HangVerdict =
  | { ok: true }
  | { ok: false; kind: "hang_no_event" | "hang_no_tool_use" | "api_retry_storm" };

/**
 * Given the current sink + the runner start time + a clock, decide whether
 * the run is hung and (if so) which heuristic fired. The runner calls this
 * on a 10s tick. Pure function for testability.
 */
export function evaluateHang(
  sink: StreamSink,
  startedAt: number,
  now = Date.now(),
): HangVerdict {
  // No event of any kind for 60s after the first 60s of runtime.
  if (now - sink.lastAnyEventAt > 60_000 && now - startedAt > 60_000) {
    return { ok: false, kind: "hang_no_event" };
  }
  // Text deltas keep streaming but no tool_use for 90s.
  if (
    sink.lastTextDeltaAt > sink.lastToolUseAt &&
    now - sink.lastToolUseAt > 90_000
  ) {
    return { ok: false, kind: "hang_no_tool_use" };
  }
  if (sink.apiRetryAttempts >= 5) {
    return { ok: false, kind: "api_retry_storm" };
  }
  return { ok: true };
}
