/* eslint-disable no-console */
const level = (process.env.LOG_LEVEL ?? "info").toLowerCase();
const LEVELS = ["debug", "info", "warn", "error"] as const;
type Level = (typeof LEVELS)[number];
const cutoff = LEVELS.indexOf(level as Level);

// C3: set LOG_FORMAT=json for a one-line-per-event JSON output that pipes
// cleanly through `jq`. Default text format stays human-readable for
// `npm run dev` debugging.
const jsonMode = (process.env.LOG_FORMAT ?? "").toLowerCase() === "json";

function ts() {
  return new Date().toISOString();
}

function out(lv: Level, scope: string, msg: string, extra?: unknown) {
  if (LEVELS.indexOf(lv) < cutoff) return;
  if (jsonMode) {
    console.log(
      JSON.stringify({
        t: ts(),
        level: lv,
        scope,
        msg,
        ...(extra !== undefined ? { extra } : {}),
      }),
    );
    return;
  }
  const line = `${ts()} ${lv.padEnd(5)} [${scope}] ${msg}`;
  if (extra !== undefined) console.log(line, extra);
  else console.log(line);
}

export const log = {
  debug: (scope: string, msg: string, extra?: unknown) => out("debug", scope, msg, extra),
  info: (scope: string, msg: string, extra?: unknown) => out("info", scope, msg, extra),
  warn: (scope: string, msg: string, extra?: unknown) => out("warn", scope, msg, extra),
  error: (scope: string, msg: string, extra?: unknown) => out("error", scope, msg, extra),
};
