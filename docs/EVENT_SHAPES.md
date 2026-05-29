# Claude Code stream-json event shapes

Reference for the NDJSON events emitted by `claude -p --output-format
stream-json --verbose --include-partial-messages`. The parser in
`src/claude/stream.ts` depends on these. **If Anthropic revises the
format, this file gets out of date — capture a fresh transcript and
update before tweaking the parser.**

Capture a real transcript:

```bash
claude -p "summarize this repo" --bare \
  --output-format stream-json --verbose --include-partial-messages \
  --allowedTools Read > /tmp/claude.ndjson
```

## The events we depend on

### system / init

Emitted first. Carries the session id we use for `--resume` and audit.

```json
{ "type": "system", "subtype": "init", "session_id": "uuid", "model": "...", "cwd": "..." }
```

### system / api_retry

Emitted by Claude Code when the SDK hits a 5xx and retries internally. We
treat `attempt >= 5` as an "api_retry_storm" hang and kill the process.

```json
{ "type": "system", "subtype": "api_retry", "attempt": 3 }
```

### stream_event with partial messages

With `--include-partial-messages`, every assistant turn emits a flurry of
`stream_event` envelopes. We care about two of the inner types.

**content_block_start** — when a new block is opened (text or tool use).

```json
{
  "type": "stream_event",
  "event": {
    "type": "content_block_start",
    "index": 0,
    "content_block": { "type": "tool_use", "id": "...", "name": "Bash", "input": {} }
  }
}
```

For `content_block.type === "tool_use"` we advance `lastToolUseAt` and
remember `lastToolName`. This is the **only** reliable signal that the
agent is making progress on tool calls — the inner content_block_delta
events that follow are deltas to the tool input, which can stream
indefinitely without indicating progress.

**content_block_delta** — token streaming for the active block.

```json
{
  "type": "stream_event",
  "event": {
    "type": "content_block_delta",
    "index": 0,
    "delta": { "type": "text_delta", "text": "Looking at " }
  }
}
```

`delta.type === "text_delta"` updates `lastTextDeltaAt`. The hang
heuristic "text streaming but no tool calls for 90s" relies on the
relative ordering of `lastTextDeltaAt` vs `lastToolUseAt`.

### assistant / user (turn boundaries)

When the agent finishes a turn, Claude Code emits an `assistant` event
with the full assembled `message.content[]`. We do a defensive walk over
the content blocks looking for `type: "tool_use"` — in some captures
this is the first place we'd see a tool call (when the stream_event
wrapper was abbreviated).

```json
{
  "type": "assistant",
  "message": {
    "role": "assistant",
    "content": [
      { "type": "text", "text": "Looking at the issue..." },
      { "type": "tool_use", "id": "...", "name": "Read", "input": { "path": "src/x.ts" } }
    ]
  }
}
```

### result

Final event. Carries the cost we budget against + the final text/structured
output we return from `runClaudeCode()`.

```json
{
  "type": "result",
  "result": "Done. Files changed: …",
  "structured_output": { "completed": true, "files_changed": ["src/x.ts"] },
  "total_cost_usd": 0.1234,
  "session_id": "uuid"
}
```

`structured_output` is present when `--json-schema` is in play (planner +
critic). Otherwise we fall back to `result` (string).

## What we ignore

- Per-tool result events (`type: "tool_result"`) — we already know a tool
  was used from `content_block_start`.
- Anything with `subtype: "debug"` or non-JSON banner lines printed by
  Claude Code in `--verbose` mode.

## If shapes change

The wrapper degrades safely. `consumeStreamLine()` swallows malformed
JSON, and an unknown `type` is treated as "some kind of progress" — we
still bump `lastAnyEventAt` so the no-event hang heuristic doesn't fire.

What can break:

- `lastToolUseAt` stops advancing → after 90s of text-only deltas, the
  wrapper kills the run as `hang_no_tool_use`. Symptom: healthy runs
  dying.
- `total_cost_usd` stops surfacing → budgets become advisory; the
  per-day budget guard becomes a lie. Symptom: the runs table cost
  column stays at $0.

Both surface in `test/stream.test.ts`. Run that against the captured
NDJSON before bumping the wrapper.
