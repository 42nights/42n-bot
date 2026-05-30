import { NextRequest, NextResponse } from "next/server";
import { ensureSchema } from "@/src/db/migrate";
import { db } from "@/src/db";
import { saveAppCreds } from "@/src/github/app";
import { log } from "@/src/shared/logger";

export const runtime = "nodejs";

/**
 * GitHub App Manifest flow — step 2.
 *
 * GitHub redirects here after the user clicks "Create GitHub App" with
 *   ?code=<exchangeable-code>&state=<our-csrf>
 *
 * We:
 *   1. Validate the state matches one we issued
 *   2. POST to /app-manifests/<code>/conversions to get full creds
 *   3. Persist them to app_credentials (id=1)
 *   4. Bounce the user to /repos so they can hit "Install" next
 */
export async function GET(req: NextRequest) {
  ensureSchema();

  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");

  if (!code || !state) {
    return NextResponse.redirect(
      new URL("/repos?setup=missing-code", req.url),
    );
  }

  const stateRow = db
    .prepare(`SELECT created_at FROM app_setup_state WHERE state = ?`)
    .get(state) as { created_at: number } | undefined;
  if (!stateRow) {
    return NextResponse.redirect(new URL("/repos?setup=bad-state", req.url));
  }
  // GitHub's manifest `code` expires in 60s. We give the user 10 minutes to
  // get through the form on github.com; older state rows are stale and
  // shouldn't be honored even if somehow re-played.
  const TEN_MIN_MS = 10 * 60 * 1000;
  const ageMs = Date.now() - stateRow.created_at;
  // One-time use either way.
  db.prepare(`DELETE FROM app_setup_state WHERE state = ?`).run(state);
  // Purge any other stale state rows while we have the DB open.
  db.prepare(`DELETE FROM app_setup_state WHERE created_at < ?`).run(
    Date.now() - TEN_MIN_MS,
  );
  if (ageMs > TEN_MIN_MS) {
    return NextResponse.redirect(
      new URL("/repos?setup=state-expired", req.url),
    );
  }

  try {
    const res = await fetch(
      `https://api.github.com/app-manifests/${encodeURIComponent(code)}/conversions`,
      {
        method: "POST",
        headers: {
          accept: "application/vnd.github+json",
          "user-agent": "42n-bot/0.1",
        },
      },
    );
    if (!res.ok) {
      const body = await res.text();
      log.error(
        "gh-app",
        `manifest exchange failed ${res.status}: ${body.slice(0, 300)}`,
      );
      return NextResponse.redirect(
        new URL(
          `/repos?setup=error&msg=${encodeURIComponent(`GitHub returned ${res.status}`)}`,
          req.url,
        ),
      );
    }
    const data = (await res.json()) as {
      id: number;
      slug: string;
      client_id: string | null;
      client_secret: string | null;
      webhook_secret: string | null;
      pem: string;
      html_url: string;
    };

    saveAppCreds({
      appId: data.id,
      slug: data.slug,
      clientId: data.client_id,
      clientSecret: data.client_secret,
      webhookSecret: data.webhook_secret,
      privateKeyPem: data.pem,
    });

    return NextResponse.redirect(
      new URL(`/repos?setup=ok&slug=${encodeURIComponent(data.slug)}`, req.url),
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log.error("gh-app", `manifest exchange threw: ${msg}`);
    return NextResponse.redirect(
      new URL(
        `/repos?setup=error&msg=${encodeURIComponent(msg.slice(0, 200))}`,
        req.url,
      ),
    );
  }
}
