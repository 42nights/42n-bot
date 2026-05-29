import { describe, it, expect } from "vitest";
import {
  consumeStreamLine,
  emptySink,
  evaluateHang,
  type StreamSink,
} from "../src/claude/stream";

// Each line below is one NDJSON event the wrapper would see from
// `claude -p --output-format stream-json --verbose --include-partial-messages`.
// These shapes are captured from real runs and documented in docs/EVENT_SHAPES.md.

function feed(lines: string[], at = 1_000): StreamSink {
  const sink = emptySink(at);
  let now = at;
  for (const line of lines) {
    now += 100;
    consumeStreamLine(line, sink, now);
  }
  return sink;
}

describe("consumeStreamLine — system + result", () => {
  it("captures session_id on system/init", () => {
    const sink = feed([
      JSON.stringify({ type: "system", subtype: "init", session_id: "sess-abc" }),
    ]);
    expect(sink.sessionId).toBe("sess-abc");
  });

  it("captures total_cost_usd on result", () => {
    const sink = feed([
      JSON.stringify({
        type: "result",
        result: "done",
        total_cost_usd: 0.1234,
        session_id: "sess-1",
      }),
    ]);
    expect(sink.totalCostUsd).toBeCloseTo(0.1234);
    expect(sink.lastTextResult).toBe("done");
    expect(sink.sessionId).toBe("sess-1");
  });

  it("captures structured_output on result", () => {
    const out = { ok: true, files: ["a.ts"] };
    const sink = feed([
      JSON.stringify({
        type: "result",
        structured_output: out,
        total_cost_usd: 0.05,
      }),
    ]);
    expect(sink.structuredOutput).toEqual(out);
  });

  it("tracks api_retry_attempts under system/api_retry", () => {
    const sink = feed([
      JSON.stringify({ type: "system", subtype: "api_retry", attempt: 1 }),
      JSON.stringify({ type: "system", subtype: "api_retry", attempt: 3 }),
      JSON.stringify({ type: "system", subtype: "api_retry", attempt: 2 }),
    ]);
    expect(sink.apiRetryAttempts).toBe(3); // monotonic max
  });
});

describe("consumeStreamLine — stream_event wrapper (partial messages)", () => {
  it("advances lastToolUseAt on content_block_start{type:tool_use}", () => {
    const before = emptySink(1_000);
    consumeStreamLine(
      JSON.stringify({
        type: "stream_event",
        event: {
          type: "content_block_start",
          content_block: { type: "tool_use", name: "Bash" },
        },
      }),
      before,
      5_000,
    );
    expect(before.lastToolUseAt).toBe(5_000);
    expect(before.lastToolName).toBe("Bash");
  });

  it("advances lastTextDeltaAt on content_block_delta{type:text_delta}", () => {
    const sink = emptySink(1_000);
    consumeStreamLine(
      JSON.stringify({
        type: "stream_event",
        event: {
          type: "content_block_delta",
          delta: { type: "text_delta", text: "hi" },
        },
      }),
      sink,
      9_000,
    );
    expect(sink.lastTextDeltaAt).toBe(9_000);
  });
});

describe("consumeStreamLine — assistant/user turn boundaries", () => {
  it("finds tool_use blocks inside assistant message.content", () => {
    const sink = emptySink(1_000);
    consumeStreamLine(
      JSON.stringify({
        type: "assistant",
        message: {
          content: [
            { type: "text", text: "thinking" },
            { type: "tool_use", name: "Edit" },
          ],
        },
      }),
      sink,
      4_000,
    );
    expect(sink.lastToolUseAt).toBe(4_000);
    expect(sink.lastToolName).toBe("Edit");
  });

  it("ignores malformed JSON without throwing", () => {
    const sink = emptySink(1_000);
    expect(() =>
      consumeStreamLine("{ this is not json", sink, 2_000),
    ).not.toThrow();
    expect(sink.lastTextDeltaAt).toBe(0);
  });
});

describe("evaluateHang", () => {
  it("ok when within tolerances", () => {
    const sink = emptySink(1_000);
    sink.lastToolUseAt = 5_000;
    sink.lastTextDeltaAt = 5_000;
    expect(evaluateHang(sink, 1_000, 6_000).ok).toBe(true);
  });

  it("flags hang_no_event when nothing for >60s after warmup", () => {
    const sink = emptySink(1_000);
    sink.lastAnyEventAt = 1_000;
    const r = evaluateHang(sink, 1_000, 1_000 + 70_000);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.kind).toBe("hang_no_event");
  });

  it("flags hang_no_tool_use when text streams but no tools", () => {
    // Recent text deltas → lastAnyEventAt stays fresh → no_event check
    // doesn't fire. But the gap since last tool_use is large → no_tool_use
    // wins.
    const now = 1_000 + 200_000;
    const sink = emptySink(1_000);
    sink.lastAnyEventAt = now;
    sink.lastTextDeltaAt = now;
    sink.lastToolUseAt = 1_000;
    const r = evaluateHang(sink, 1_000, now);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.kind).toBe("hang_no_tool_use");
  });

  it("flags api_retry_storm at 5 attempts", () => {
    const sink = emptySink(1_000);
    sink.apiRetryAttempts = 5;
    const r = evaluateHang(sink, 1_000, 1_000);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.kind).toBe("api_retry_storm");
  });
});
