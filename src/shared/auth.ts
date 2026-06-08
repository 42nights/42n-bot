import crypto from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { log } from "./logger";

/**
 * Auth gate for mutating dashboard / admin API routes.
 *
 * There is no user-session layer in this app, so privileged routes (creating
 * GitHub issues, dispatching the coordinator, spawning Claude Code, cloning
 * repos, scheduling crons) must not be callable by an arbitrary cross-site or
 * scripted client. A request is authorized when EITHER:
 *
 *  1. it carries the shared secret — `Authorization: Bearer <secret>` or
 *     `x-admin-secret: <secret>` matching `OTIS_ADMIN_SECRET` (for cron jobs,
 *     CLI tooling, server-to-server calls); OR
 *  2. it is a first-party browser request from the dashboard itself, proven by
 *     `Sec-Fetch-Site: same-origin` (or `same-site`). This is set by the
 *     browser and cannot be forged from a cross-site page or a curl request,
 *     so the live dashboard UI keeps working without shipping a secret to the
 *     client, while external attackers are rejected.
 *
 * Fail-closed: a programmatic request (no/`cross-site`/`none` Sec-Fetch-Site)
 * without a valid secret is rejected. When `OTIS_ADMIN_SECRET` is unset the
 * secret path is simply unavailable; first-party UI requests still pass.
 *
 * Returns a `NextResponse` to short-circuit the handler when the request is
 * rejected, or `null` when the request is authorized.
 */
export function requireAdmin(req: NextRequest): NextResponse | null {
  if (isFirstPartyBrowserRequest(req)) return null;

  const expected = process.env.OTIS_ADMIN_SECRET;
  const header = req.headers.get("authorization");
  const bearer = header?.startsWith("Bearer ")
    ? header.slice("Bearer ".length)
    : null;
  const provided = bearer ?? req.headers.get("x-admin-secret") ?? "";

  if (expected && timingSafeEqualStr(provided, expected)) return null;

  log.warn("auth", `rejected unauthorized ${req.method} ${req.nextUrl.pathname}`);
  return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
}

/**
 * A genuine same-origin/same-site fetch or navigation from the dashboard.
 * `Sec-Fetch-Site` is a forbidden header set by the browser — page scripts
 * (including a malicious cross-origin page) cannot override it, and non-browser
 * clients (curl, attacker scripts) don't send it at all.
 */
function isFirstPartyBrowserRequest(req: NextRequest): boolean {
  const site = req.headers.get("sec-fetch-site");
  return site === "same-origin" || site === "same-site";
}

function timingSafeEqualStr(a: string, b: string): boolean {
  const ab = Buffer.from(a, "utf8");
  const bb = Buffer.from(b, "utf8");
  if (ab.length !== bb.length) return false;
  return crypto.timingSafeEqual(ab, bb);
}
