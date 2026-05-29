/* eslint-disable no-console */
const level = (process.env.LOG_LEVEL ?? "info").toLowerCase();
const LEVELS = ["debug", "info", "warn", "error"] as const;
type Level = (typeof LEVELS)[number];
const cutoff = LEVELS.indexOf(level as Level);

function ts() {
  return new Date().toISOString();
}

function out(lv: Level, scope: string, msg: string, extra?: unknown) {
  if (LEVELS.indexOf(lv) < cutoff) return;
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
