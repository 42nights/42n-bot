import { NextRequest, NextResponse } from "next/server";
import {
  saveAppCreds,
  getSetupState,
  deleteSetupState,
  pruneSetupStates,
} from "@/src/github/app";
import { log } from "@/src/shared/logger";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");

  if (!code || !state) {
    return NextResponse.redirect(new URL("/repos?setup=missing-code", req.url));
  }

  const stateRow = await getSetupState(state);
  if (!stateRow) {
    return NextResponse.redirect(new URL("/repos?setup=bad-state", req.url));
  }

  const TEN_MIN_MS = 10 * 60 * 1000;
  const ageMs = Date.now() - stateRow.created_at;
  await deleteSetupState(state);
  await pruneSetupStates(Date.now() - TEN_MIN_MS);

  if (ageMs > TEN_MIN_MS) {
    return NextResponse.redirect(new URL("/repos?setup=state-expired", req.url));
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

    await saveAppCreds({
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
