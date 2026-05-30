import { execa } from "execa";
import { botConfig } from "../../bot.config";
import { log } from "../shared/logger";

/**
 * The Claude CLI prefers `ANTHROPIC_API_KEY` over its cached OAuth token when
 * both are present. If the env has a stale/empty/placeholder key (very common
 * in shells that previously sourced one), the CLI bails with "Not logged in"
 * before it even tries OAuth. Strip the var so the CLI falls back to its
 * keychain login, unless the user explicitly opts back into API-key mode.
 */
function spawnEnv(): NodeJS.ProcessEnv {
  if (process.env.USE_ANTHROPIC_API_KEY === "1") return process.env;
  const out = { ...process.env };
  delete out.ANTHROPIC_API_KEY;
  delete out.ANTHROPIC_AUTH_TOKEN;
  return out;
}

/**
 * One-shot, non-streaming Claude CLI call. Used for short structured prompts
 * (planner, critic, chat synthesis) where we don't need event streaming or
 * tool-use mid-conversation — we just want a single text answer back.
 *
 * Auth: relies on whatever auth the `claude` CLI is configured with on the
 * host (Claude.app login, ~/.claude.json, or ANTHROPIC_API_KEY). The bot does
 * not pass an API key explicitly; the CLI owns its own auth.
 *
 * Returns the `result` string from `--output-format json`. If `expectJson` is
 * true, tries to extract the first JSON object/array from the result and
 * parse it.
 */
export async function runClaudeHeadless(opts: {
  prompt: string;
  cwd?: string;
  timeoutMs?: number;
  systemPromptAppend?: string;
  expectJson?: boolean;
  model?: string;
}): Promise<
  | { ok: true; text: string; json?: unknown; costUsd: number }
  | { ok: false; error: string }
> {
  const args: string[] = [
    "-p",
    opts.prompt,
    "--output-format",
    "json",
  ];
  if (opts.model) args.push("--model", opts.model);
  if (opts.systemPromptAppend) {
    args.push("--append-system-prompt", opts.systemPromptAppend);
  }
  try {
    const child = await execa(botConfig.claudeCode.bin, args, {
      cwd: opts.cwd,
      timeout: opts.timeoutMs ?? botConfig.claudeCode.criticTimeoutMs,
      killSignal: "SIGKILL",
      env: spawnEnv(),
      encoding: "utf8",
      maxBuffer: 32 * 1024 * 1024,
    });
    let parsed: { result?: string; total_cost_usd?: number };
    try {
      parsed = JSON.parse(child.stdout);
    } catch (err) {
      log.warn("headless", `non-JSON stdout: ${child.stdout.slice(0, 200)}`);
      return { ok: false, error: `CLI stdout was not JSON: ${(err as Error).message}` };
    }
    const text = (parsed.result ?? "").trim();
    if (!text) return { ok: false, error: "CLI returned empty result" };
    if (parsed.total_cost_usd == null) {
      log.warn(
        "headless",
        "CLI JSON has no `total_cost_usd` — cost tracking will read $0 for this call",
      );
    }
    const costUsd = parsed.total_cost_usd ?? 0;
    if (!opts.expectJson) {
      return { ok: true, text, costUsd };
    }
    const json = extractJson(text);
    if (json === undefined) {
      return {
        ok: false,
        error: `Could not parse JSON from CLI output: ${text.slice(0, 240)}`,
      };
    }
    return { ok: true, text, json, costUsd };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, error: msg };
  }
}

/**
 * Find the first balanced JSON object or array in `s` that actually PARSES,
 * and return it. Tolerates preamble/postamble prose and code fences.
 *
 * QA3 (R3 finding 12): the previous version pulled the first ```fenced```
 * block out FIRST, which meant `{"real":1}\n```{"fake":2}```` returned the
 * fake (the JSON inside a later fence) over the real bare object. And prose
 * containing a `{placeholder}` would make it give up entirely.
 *
 * The fix: scan EVERY balanced `{...}` / `[...]` region from the start of the
 * string and return the first one that JSON.parses. This is order-preserving
 * (earliest valid JSON wins) and skips non-JSON brace runs (markdown
 * `{placeholder}`, etc.) instead of choking on them.
 */
export function extractJson(s: string): unknown {
  for (let i = 0; i < s.length; i++) {
    const opener = s[i];
    if (opener !== "{" && opener !== "[") continue;
    const region = balancedRegion(s, i);
    if (region === null) continue;
    try {
      const parsed = JSON.parse(s.slice(i, region + 1));
      return parsed;
    } catch {
      // Not valid JSON at this position — keep scanning for the next opener.
      continue;
    }
  }
  return undefined;
}

/**
 * Returns the index of the matching closer for the opener at `start`, or null
 * if the braces don't balance before the string ends. String-aware (ignores
 * braces inside JSON string literals + handles escapes).
 */
function balancedRegion(s: string, start: number): number | null {
  const opener = s[start];
  const closer = opener === "{" ? "}" : "]";
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let i = start; i < s.length; i++) {
    const c = s[i];
    if (inStr) {
      if (esc) {
        esc = false;
        continue;
      }
      if (c === "\\") {
        esc = true;
        continue;
      }
      if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') {
      inStr = true;
      continue;
    }
    if (c === opener) depth++;
    else if (c === closer) {
      depth--;
      if (depth === 0) return i;
    }
  }
  return null;
}
