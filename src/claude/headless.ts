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
  // QA5 (R5 finding 2): a SINGLE linear O(n) pass. The prior "try every
  // opener, scan each to EOF" was O(n²) and a budget cap could starve out a
  // legitimate large JSON sitting after lots of balanced code-example braces
  // (each failed scan burned budget). This walks the string once, tracking
  // bracket depth with a stack, and whenever a TOP-LEVEL region closes
  // (depth returns to 0) it tries to JSON.parse that region. Each character
  // is visited once → O(n) total regardless of how many candidate regions
  // exist. String-aware (ignores brackets inside JSON string literals).
  //
  // The one case this can't recover: valid JSON nested inside an opener that
  // is itself never closed (e.g. `{garbage {"valid":1}`). That's degenerate
  // input we accept returning undefined for.
  let inStr = false;
  let esc = false;
  let startIdx = -1; // start of the current top-level region
  let startChar = ""; // '{' or '[' that opened it
  const stack: string[] = [];

  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (inStr) {
      if (esc) esc = false;
      else if (c === "\\") esc = true;
      else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') {
      inStr = true;
      continue;
    }
    if (c === "{" || c === "[") {
      if (stack.length === 0) {
        startIdx = i;
        startChar = c;
      }
      stack.push(c);
    } else if (c === "}" || c === "]") {
      if (stack.length === 0) continue; // stray closer in prose
      const open = stack.pop()!;
      const matches =
        (open === "{" && c === "}") || (open === "[" && c === "]");
      if (!matches) {
        // Mismatched bracket — reset; this region is malformed.
        stack.length = 0;
        startIdx = -1;
        continue;
      }
      if (stack.length === 0 && startIdx >= 0) {
        // Completed a top-level region. Try to parse it.
        const candidate = s.slice(startIdx, i + 1);
        // Only bother if it looks like the start of a JSON value.
        if (startChar === "{" || startChar === "[") {
          try {
            return JSON.parse(candidate);
          } catch {
            // Balanced but not JSON (e.g. a code block) — keep scanning.
          }
        }
        startIdx = -1;
      }
    }
  }
  return undefined;
}
