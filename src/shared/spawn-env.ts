/**
 * Minimal, allowlisted environments for subprocesses that operate on untrusted
 * repo contents (Claude Code, dependency installs, the repo's own test/dev
 * tooling). Cloning the full `process.env` into such a process hands every host
 * secret — GITHUB_TOKEN, Convex deploy key, webhook secret, OpenAI/Anthropic
 * keys — to attacker-controllable lifecycle scripts. We build the child env
 * from an explicit allowlist instead.
 */

/**
 * Base env every child needs to function: the toolchain on PATH, a HOME for
 * per-user config/caches, and the locale. Nothing secret. We pass through only
 * the values that are actually set so we never invent empty vars.
 */
function baseChildEnv(): Record<string, string> {
  const ALLOW = [
    "PATH",
    "HOME",
    "NODE_ENV",
    "LANG",
    "LC_ALL",
    "TZ",
    "TMPDIR",
    "TEMP",
    "TMP",
    "SHELL",
    "USER",
    "LOGNAME",
    // Windows toolchains resolve binaries via these.
    "SYSTEMROOT",
    "SystemRoot",
    "COMSPEC",
    "PATHEXT",
  ] as const;
  const out: Record<string, string> = {};
  for (const k of ALLOW) {
    const v = process.env[k];
    if (v != null) out[k] = v;
  }
  return out;
}

/**
 * Env for the Claude Code subprocess. Inherits the base toolchain env plus the
 * Anthropic auth the CLI legitimately needs — but NOT the rest of the host
 * secrets. By default the CLI authenticates through its keychain/OAuth login
 * (resolved via HOME), so we strip the API key vars; set USE_ANTHROPIC_API_KEY=1
 * to pass them through explicitly.
 */
export function claudeSpawnEnv(): Record<string, string> {
  const env = baseChildEnv();
  if (process.env.USE_ANTHROPIC_API_KEY === "1") {
    if (process.env.ANTHROPIC_API_KEY)
      env.ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
    if (process.env.ANTHROPIC_AUTH_TOKEN)
      env.ANTHROPIC_AUTH_TOKEN = process.env.ANTHROPIC_AUTH_TOKEN;
    if (process.env.ANTHROPIC_BASE_URL)
      env.ANTHROPIC_BASE_URL = process.env.ANTHROPIC_BASE_URL;
  }
  return env;
}

/**
 * Env for a dependency install (`npm ci`, `pnpm install`, …) of a cloned,
 * attacker-controllable repo. Base toolchain only, plus the CI flag installers
 * expect. No host secrets reach the repo's lifecycle scripts.
 */
export function installSpawnEnv(): Record<string, string> {
  return { ...baseChildEnv(), CI: "1", npm_config_fund: "false" };
}
