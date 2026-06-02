// Direct Anthropic Messages API call for the dashboard chat answer. The
// coordinator's implementer uses the Claude Code CLI (runClaudeHeadless), but
// that binary isn't present in serverless runtimes — the chat answer is a
// single-turn Q&A, so it hits the HTTP API instead.

const MODEL = process.env.OTIS_CHAT_MODEL ?? "claude-sonnet-4-6";

export type LlmResult =
  | { ok: true; text: string }
  | { ok: false; error: string };

export async function askAnthropic(opts: {
  system: string;
  prompt: string;
  maxTokens?: number;
  timeoutMs?: number;
}): Promise<LlmResult> {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return { ok: false, error: "ANTHROPIC_API_KEY not set" };

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), opts.timeoutMs ?? 60_000);
  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": key,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: opts.maxTokens ?? 1024,
        system: opts.system,
        messages: [{ role: "user", content: opts.prompt }],
      }),
      signal: ctrl.signal,
    });
    if (!res.ok) {
      return { ok: false, error: `Anthropic ${res.status}: ${(await res.text()).slice(0, 200)}` };
    }
    const data = (await res.json()) as { content?: Array<{ type: string; text?: string }> };
    const text = (data.content ?? [])
      .filter((b) => b.type === "text" && b.text)
      .map((b) => b.text)
      .join("")
      .trim();
    if (!text) return { ok: false, error: "empty response" };
    return { ok: true, text };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  } finally {
    clearTimeout(timer);
  }
}
