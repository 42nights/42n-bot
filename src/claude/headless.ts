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
 * Find the first balanced JSON object or array in `s` and parse it. Tolerates
 * preamble/postamble text and code fences so the model doesn't have to be
 * pixel-perfect.
 */
export function extractJson(s: string): unknown {
  const fenced = s.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidate = fenced ? fenced[1] : s;
  const firstObj = candidate.indexOf("{");
  const firstArr = candidate.indexOf("[");
  const start =
    firstObj === -1
      ? firstArr
      : firstArr === -1
        ? firstObj
        : Math.min(firstObj, firstArr);
  if (start === -1) return undefined;
  const opener = candidate[start];
  const closer = opener === "{" ? "}" : "]";
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let i = start; i < candidate.length; i++) {
    const c = candidate[i];
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
      if (depth === 0) {
        try {
          return JSON.parse(candidate.slice(start, i + 1));
        } catch {
          return undefined;
        }
      }
    }
  }
  return undefined;
}
