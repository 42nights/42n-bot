import { NextRequest, NextResponse } from "next/server";
import { randomBytes } from "node:crypto";
import { ensureSchema } from "@/src/db/migrate";
import { db } from "@/src/db";

export const runtime = "nodejs";

/**
 * GitHub App Manifest flow — step 1.
 *
 * Returns a self-submitting HTML form that POSTs to
 * https://github.com/settings/apps/new?state=<csrf>
 * with our manifest. The user sees the GitHub "Create GitHub App" confirmation
 * page (everything pre-filled), clicks once, and GitHub redirects them to our
 * setup-callback with a ?code= we can exchange.
 *
 * Docs: https://docs.github.com/en/apps/sharing-github-apps/registering-a-github-app-from-a-manifest
 */
export async function GET(req: NextRequest) {
  ensureSchema();

  const origin = originFor(req);
  const state = randomBytes(16).toString("hex");
  db.prepare(
    `INSERT INTO app_setup_state (state, created_at) VALUES (?, ?)`,
  ).run(state, Date.now());

  // Note: we intentionally omit `hook_attributes` and `default_events`.
  // GitHub rejects manifests with localhost webhook URLs (the URL has to be
  // publicly reachable, even if `active: false`). We don't use webhooks for
  // the local-dev flow — the coordinator polls every 60s instead. The user
  // can add a webhook URL later from the App's Settings page if they want
  // sub-minute reaction time (typically via ngrok or a public deploy).
  const manifest = {
    name: "42n-bot",
    url: origin,
    redirect_url: `${origin}/api/github/app/setup-callback`,
    setup_url: `${origin}/api/github/app/callback`,
    setup_on_update: true,
    public: false,
    default_permissions: {
      contents: "write",
      issues: "write",
      pull_requests: "write",
      metadata: "read",
      workflows: "write",
    },
  };

  const action = `https://github.com/settings/apps/new?state=${encodeURIComponent(state)}`;
  const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>Creating GitHub App…</title>
  <style>
    body { font-family: ui-sans-serif, system-ui, sans-serif; padding: 4rem; max-width: 32rem; color: #111; }
    button { background: #111; color: #fff; border: 0; padding: 0.6rem 1.1rem; border-radius: 6px; font-size: 0.95rem; cursor: pointer; }
    .meta { color: #666; font-size: 0.85rem; margin-top: 0.6rem; }
  </style>
</head>
<body>
  <h2>Redirecting you to GitHub…</h2>
  <p>You'll see GitHub's "Create GitHub App" page with everything pre-filled. Click <b>Create GitHub App for &lt;your account&gt;</b> and you're back here.</p>
  <form id="f" method="post" action="${action}">
    <input type="hidden" name="manifest" value='${escapeAttr(JSON.stringify(manifest))}'>
    <button type="submit">Continue to GitHub</button>
  </form>
  <div class="meta">If you aren't redirected automatically, click the button above.</div>
  <script>document.getElementById('f').submit();</script>
</body>
</html>`;
  return new NextResponse(html, {
    status: 200,
    headers: { "content-type": "text/html; charset=utf-8" },
  });
}

function originFor(req: NextRequest): string {
  const env = process.env.DASHBOARD_URL;
  if (env) return env.replace(/\/$/, "");
  return new URL(req.url).origin;
}

function escapeAttr(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/'/g, "&#39;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
