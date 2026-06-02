# Otis — Castle Template Handoff

## Environment variables

Castle pre-fills the starred vars automatically. Everything else is optional for local dev and should be set in your Railway/Render service config for a tenant deploy.

| Variable | Castle pre-fills? | Required for tenant? | Purpose |
|---|---|---|---|
| `OTIS_TENANT_SLUG` | yes | yes | Unique slug identifying this tenant deployment (e.g. `acme`). Presence activates tenant mode. |
| `OTIS_TENANT_DISPLAY_NAME` | yes | no | Brand name shown in page title and UI chrome (default: `Otis`). |
| `OTIS_TENANT_PUBLIC_URL` | yes | yes | Canonical HTTPS URL of this deployment (e.g. `https://acme.42nights.dev`). Used in footer credit link. |
| `CASTLE_DEPLOYMENT_ID` | yes | yes | Castle deployment ID for event backlink. |
| `CASTLE_API_URL` | yes | yes | Castle API base URL (e.g. `https://api.castle.dev`). |
| `CASTLE_WEBHOOK_SECRET` | yes | no | Shared secret sent as `x-castle-secret` on every event POST. |
| `OTIS_LOGO_URL` | yes | no | HTTPS URL of a favicon/logo image. Injected as `<link rel="icon">`. |
| `OTIS_PRIMARY_COLOR` | yes | no | CSS color value for the accent token (e.g. `oklch(65% 0.18 240)` or `#3b82f6`). Falls back to default green when unset. |
| `GITHUB_TOKEN` | no | only if skipping App install | Fine-grained PAT fallback. |
| `CLAUDE_CODE_PATH` | no | no | Override if `claude` isn't on `PATH`. |
| `REPOS_ROOT` | no | no | Where to clone connected repos (default `~/.42n-bot/repos`). |
| `WORKTREE_ROOT` | no | no | Where to park bot worktrees (default `~/.42n-bot/worktrees`). |
| `DASHBOARD_URL` | no | no | Deep-link target in PR bodies (default `http://localhost:3000`). |
| `USE_OPENAI_EMBEDDINGS` | no | no | Set to `1` to use OpenAI embeddings instead of local. |
| `OPENAI_API_KEY` | no | only with `USE_OPENAI_EMBEDDINGS=1` | OpenAI auth. |
| `GITHUB_WEBHOOK_SECRET` | no | no | HMAC secret for webhook delivery verification. |
| `USE_ANTHROPIC_API_KEY` | no | no | Set to `1` to use `ANTHROPIC_API_KEY` for CLI auth instead of Claude.app OAuth. |

## First 60 seconds

1. Open your live URL (e.g. `https://acme.42nights.dev`).
2. On the Settings page, click **Create GitHub App** — this opens `github.com/settings/apps/new` pre-filled with the right scopes. Approve, then click **Install** on the repos you want Otis on. GitHub redirects back automatically and the app credentials are stored.
3. If a repo doesn't auto-appear, go to Settings → Repos → add it and click **Clone**.
4. Label any GitHub issue `bot-please` (or type a task in the home prompt box and hit Send).
5. Watch the session appear on the Sessions page within 60 seconds.

## Failure modes

**Build hangs / coordinator never starts**
- The coordinator is a persistent Node process. On Railway, check the service logs. The most common cause is a missing `claude` binary — the Claude Code CLI must be installed in the container: `npm install -g @anthropic-ai/claude-code`.
- If `OTIS_TENANT_SLUG` is set but `OTIS_TENANT_PUBLIC_URL`, `CASTLE_DEPLOYMENT_ID`, or `CASTLE_API_URL` are missing, the coordinator throws on startup with a clear error listing the missing vars.

**GitHub App install didn't land**
- The app credentials are stored on first redirect from `github.com`. If the callback URL (`/api/github/app/setup-callback`) is unreachable (wrong `DASHBOARD_URL` or no public ingress), the exchange code expires (10 minutes). Re-run the Create GitHub App flow.
- Check Settings → GitHub App — the app name and installation ID should appear there.

**Coordinator restart mid-session**
- On restart, `recoverCrashedRuns` walks every worktree directory and resets any run that was `queued/planning/implementing/verifying/iterating` but has no running process. The run row is marked `failed` with `error_message: "recovered after crash"` and the worktree is reaped. The issue keeps `bot-please`; the poller picks it up on the next 60-second tick.
- A circuit breaker trips after 3 failed/abandoned runs on the same issue within 2 hours — remove and re-add `bot-please` to retry.

**Sessions get picked up but no PR appears**
- Check `REPOS_ROOT` is writable and the initial clone completed. The Session workspace Terminal tab shows the raw Claude Code subprocess output.
- Budget guards: if `botConfig.budgets.perDayUsd` is exhausted, the coordinator logs a warning and defers all new pickups until the next UTC day. This threshold is in `bot.config.ts`.

## Anthropic cost attribution

Otis drives Claude entirely through the Claude Code CLI (`claude -p` subprocesses). There is no direct Anthropic SDK call in this codebase — `src/verification/critic.ts`, `src/verification/critic2.ts`, and `src/chat/answer.ts` all go through `runClaudeHeadless` which spawns the CLI.

As a result, **per-tenant Anthropic cost attribution is not available at the API level**. Cost flows through whichever API key or OAuth session the `claude` CLI is authenticated with on the host.

For tenant deploys, the recommended pattern is:
- Each tenant service authenticates the CLI with a dedicated org-level `ANTHROPIC_API_KEY` (set `USE_ANTHROPIC_API_KEY=1`). Costs are then scoped to that org key in the Anthropic dashboard.
- Castle's own `user_id` metadata stamping (playbook §4) cannot be injected via the CLI's subprocess interface. If Anthropic adds a `--user-id` flag to the CLI in a future version, it should be threaded through `spawnEnv()` in `src/claude/headless.ts` and `src/claude/runner.ts`.
