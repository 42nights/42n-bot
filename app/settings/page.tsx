"use client";

// 'use client' — repo management requires SWR, toast, form state.

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import useSWR from "swr";
import { toast } from "sonner";
import { fetcher } from "@/lib/api-client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  Trash2,
  Power,
  PowerOff,
  CheckCircle2,
  XCircle,
  GitBranch,
  ExternalLink,
  Github,
  Search,
  Loader2,
  Download,
  Eye,
  EyeOff,
  Moon,
  Sun,
  Volume2,
  VolumeX,
} from "lucide-react";

// ── Types ─────────────────────────────────────────────────────────────────────

type ConnectedRepo = {
  id: number;
  owner: string;
  name: string;
  default_branch: string;
  enabled: number;
  repo_dir: string | null;
  repo_url: string | null;
  description: string | null;
  installation_id: number | null;
};

type AppInfo = {
  configured: boolean;
  appName: string | null;
  installUrl: string | null;
};

type ReposResponse = {
  connected: ConnectedRepo[];
  labels: Record<string, string>;
  verification: {
    maxIterations: number;
    diffMaxLines: number;
    criticMinConfidence: number;
  };
  budgets: { perRunUsd: number; perDayUsd: number; perIssueUsd: number };
  reviewer: {
    enabled: boolean;
    intervalMinutes: number;
    maxIssuesPerRun: number;
    duplicateThreshold: number;
  };
  githubTokenConfigured: boolean;
  embeddingsBackend: "local" | "openai";
  openaiKeyConfigured: boolean;
};

// Env vars we surface (names only — never values).
const TRACKED_ENV = [
  "GITHUB_TOKEN",
  "GITHUB_WEBHOOK_SECRET",
  "ANTHROPIC_API_KEY",
  "OPENAI_API_KEY",
  "USE_OPENAI_EMBEDDINGS",
  "CLAUDE_CODE_PATH",
  "WORKTREE_ROOT",
  "REPO_DIR",
] as const;

// ── Main page ─────────────────────────────────────────────────────────────────

function SettingsContent() {
  const params = useSearchParams();
  const setupParam = params.get("setup");
  const installParam = params.get("install");
  const setupSlug = params.get("slug");
  const setupMsg = params.get("msg");
  const installCount = params.get("count");

  const { data, mutate } = useSWR<ReposResponse>("/api/repos", fetcher, {
    refreshInterval: 4000,
  });
  const { data: appInfo } = useSWR<AppInfo>("/api/github/app/info", fetcher);

  const [owner, setOwner] = useState("");
  const [name, setName] = useState("");
  const [repoDir, setRepoDir] = useState("");
  const [adding, setAdding] = useState(false);
  const [reviewing, setReviewing] = useState<number | null>(null);
  const [cloning, setCloning] = useState<number | null>(null);
  const [toggling, setToggling] = useState<number | null>(null);
  const [confirmRemove, setConfirmRemove] = useState<number | null>(null);

  // Theme
  const [dark, setDark] = useState(true);
  // Notification sound toggle — UI only for now
  const [soundEnabled, setSoundEnabled] = useState(false);

  useEffect(() => {
    const stored = localStorage.getItem("otis-theme");
    if (stored) {
      const isDark = stored === "dark";
      setDark(isDark);
      document.documentElement.classList.toggle("dark", isDark);
    }
    const sound = localStorage.getItem("otis-sound");
    setSoundEnabled(sound === "on");
  }, []);

  function toggleTheme() {
    setDark((prev) => {
      const next = !prev;
      document.documentElement.classList.toggle("dark", next);
      localStorage.setItem("otis-theme", next ? "dark" : "light");
      return next;
    });
  }

  function toggleSound() {
    setSoundEnabled((prev) => {
      const next = !prev;
      localStorage.setItem("otis-sound", next ? "on" : "off");
      return next;
    });
  }

  // Surface setup/install redirect results once.
  useEffect(() => {
    if (setupParam === "ok") {
      toast.success(`GitHub App created (${setupSlug ?? ""}). Click Install next.`);
    } else if (setupParam === "error") {
      toast.error(`Setup failed: ${setupMsg ?? "unknown"}`);
    } else if (setupParam && setupParam !== "ok") {
      toast.error(`Setup: ${setupParam}`);
    }
    if (installParam === "ok") {
      toast.success(`Installed — ${installCount ?? "?"} repo(s) connected`);
    } else if (installParam === "error") {
      toast.error(`Install failed: ${setupMsg ?? "unknown"}`);
    } else if (installParam && installParam !== "ok") {
      toast.error(`Install: ${installParam}`);
    }
    if (setupParam || installParam) {
      const url = new URL(window.location.href);
      url.search = "";
      window.history.replaceState({}, "", url.toString());
      mutate();
    }
  }, [setupParam, installParam, setupSlug, setupMsg, installCount, mutate]);

  async function addRepo(e: React.FormEvent) {
    e.preventDefault();
    setAdding(true);
    try {
      const res = await fetch("/api/repos", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          owner: owner.trim(),
          name: name.trim(),
          repoDir: repoDir.trim() || undefined,
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error((body as { error?: string }).error ?? `${res.status}`);
      }
      toast.success(`Connected ${owner}/${name}`);
      setOwner("");
      setName("");
      setRepoDir("");
      mutate();
    } catch (err) {
      toast.error((err as Error).message ?? "Failed to connect");
    } finally {
      setAdding(false);
    }
  }

  async function toggleEnabled(repo: ConnectedRepo) {
    if (toggling === repo.id) return;
    setToggling(repo.id);
    try {
      const res = await fetch(`/api/repos/${repo.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ enabled: !repo.enabled }),
      });
      if (!res.ok) throw new Error(await res.text());
      toast.success(repo.enabled ? "Paused" : "Enabled");
      mutate();
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setToggling(null);
    }
  }

  async function cloneRepo(repo: ConnectedRepo) {
    setCloning(repo.id);
    try {
      const res = await fetch(`/api/repos/${repo.id}/clone`, { method: "POST" });
      const body = await res.json();
      if (!res.ok)
        throw new Error((body as { error?: string }).error ?? `${res.status}`);
      toast.success(
        (body as { cloned?: boolean; repoDir?: string }).cloned
          ? `Cloned → ${(body as { repoDir: string }).repoDir}`
          : `Fetched → ${(body as { repoDir: string }).repoDir}`,
      );
      mutate();
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setCloning(null);
    }
  }

  async function triggerReview(repo: ConnectedRepo) {
    setReviewing(repo.id);
    try {
      if (!repo.repo_dir) {
        toast.message("Cloning first…");
        await cloneRepo(repo);
        const fresh = await mutate();
        const updated = fresh?.connected.find((x) => x.id === repo.id);
        if (!updated?.repo_dir) {
          toast.error("Clone failed; reviewer can't run.");
          return;
        }
        repo = updated;
      }
      const res = await fetch(`/api/repos/${repo.id}/review`, { method: "POST" });
      const body = await res.json();
      if (!res.ok)
        throw new Error((body as { error?: string }).error ?? `${res.status}`);
      toast.success(
        `Reviewer: proposed ${(body as { proposed: number }).proposed}, opened ${(body as { opened: number }).opened}, deduped ${(body as { deduped: number }).deduped}`,
      );
      mutate();
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setReviewing(null);
    }
  }

  async function removeRepo(repo: ConnectedRepo) {
    if (confirmRemove !== repo.id) {
      setConfirmRemove(repo.id);
      window.setTimeout(() => {
        setConfirmRemove((cur) => (cur === repo.id ? null : cur));
      }, 4000);
      return;
    }
    setConfirmRemove(null);
    try {
      const res = await fetch(`/api/repos/${repo.id}`, { method: "DELETE" });
      if (!res.ok) throw new Error(await res.text());
      toast.success("Removed");
      mutate();
    } catch (err) {
      toast.error((err as Error).message);
    }
  }

  if (!data) {
    return <div className="p-10 text-sm text-[var(--fg-muted)]">Loading…</div>;
  }

  return (
    <div className="max-w-3xl mx-auto px-8 py-10 space-y-16">
      <header>
        <h1 className="font-serif text-3xl tracking-tight">Settings</h1>
        <p className="mt-1 text-sm text-[var(--fg-muted)]">
          Connected repos, theme, and environment.
        </p>
      </header>

      {/* ── Repos section ─────────────────────────────────────────────────── */}
      <section id="repos">
        <SectionHeading>Repos</SectionHeading>
        <p className="text-sm text-[var(--fg-muted)] mb-6">
          Connect a GitHub repo so Otis can pick up{" "}
          <code className="font-mono text-xs bg-[var(--bg-sunken)] px-1.5 py-0.5 rounded">
            {data.labels.request ?? "bot-please"}
          </code>{" "}
          issues and open PRs against it.
        </p>

        <CredStrip
          data={data}
          ghAuthOk={data.githubTokenConfigured || (appInfo?.configured ?? false)}
        />

        <AppInstallCTA
          info={appInfo}
          hasConnectedRepos={data.connected.length > 0}
        />

        <div className="mb-8">
          <h3 className="text-xs uppercase tracking-wider text-[var(--fg-muted)] mb-3">
            {appInfo?.configured ? "Or add a repo with a PAT" : "Connect a repo with a PAT"}
          </h3>
          <form
            onSubmit={addRepo}
            className="rounded-xl border border-[var(--border)] bg-[var(--bg)] p-4 space-y-3"
          >
            <div className="grid grid-cols-1 sm:grid-cols-5 gap-3">
              <input
                required
                placeholder="owner"
                value={owner}
                onChange={(e) => setOwner(e.target.value)}
                className="sm:col-span-2 h-9 px-3 rounded-md border border-[var(--border)] bg-[var(--bg)] text-sm focus:outline-none focus:ring-2 focus:ring-[var(--accent)]/30"
              />
              <input
                required
                placeholder="repo-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="sm:col-span-3 h-9 px-3 rounded-md border border-[var(--border)] bg-[var(--bg)] text-sm focus:outline-none focus:ring-2 focus:ring-[var(--accent)]/30"
              />
            </div>
            <input
              placeholder="/absolute/path/to/local/clone  (optional)"
              value={repoDir}
              onChange={(e) => setRepoDir(e.target.value)}
              className="w-full h-9 px-3 rounded-md border border-[var(--border)] bg-[var(--bg)] text-sm font-mono focus:outline-none focus:ring-2 focus:ring-[var(--accent)]/30"
            />
            <div className="flex items-center justify-between text-xs text-[var(--fg-muted)]">
              <span>
                The bot probes GitHub with your{" "}
                <code className="font-mono">GITHUB_TOKEN</code> before saving.
              </span>
              <Button
                type="submit"
                variant="primary"
                size="sm"
                disabled={adding || !owner.trim() || !name.trim()}
              >
                {adding ? "Connecting…" : "Connect"}
              </Button>
            </div>
          </form>
        </div>

        <div>
          <h3 className="text-xs uppercase tracking-wider text-[var(--fg-muted)] mb-3">
            Connected ({data.connected.length})
          </h3>
          {data.connected.length === 0 ? (
            <div className="rounded-lg border border-dashed border-[var(--border)] p-10 text-center text-sm text-[var(--fg-muted)]">
              No repos yet.
            </div>
          ) : (
            <div className="space-y-2">
              {data.connected.map((r) => (
                <div
                  key={r.id}
                  className="rounded-lg border border-[var(--border)] bg-[var(--bg)] p-4"
                >
                  <div className="flex items-start gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 text-sm">
                        <span className="font-medium">
                          {r.owner}/{r.name}
                        </span>
                        {r.repo_url && (
                          <a
                            href={r.repo_url}
                            target="_blank"
                            rel="noreferrer"
                            className="text-[var(--fg-muted)] hover:text-[var(--fg)]"
                          >
                            <ExternalLink className="h-3 w-3" />
                          </a>
                        )}
                        <Badge variant={r.enabled ? "success" : "default"}>
                          {r.enabled ? "enabled" : "paused"}
                        </Badge>
                        <Badge variant="default">
                          {r.installation_id ? "via GitHub App" : "via PAT"}
                        </Badge>
                      </div>
                      {r.description && (
                        <div className="mt-1 text-xs text-[var(--fg-muted)] truncate">
                          {r.description}
                        </div>
                      )}
                      <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs text-[var(--fg-muted)] items-center">
                        <span className="inline-flex items-center gap-1">
                          <GitBranch className="h-3 w-3" />
                          {r.default_branch}
                        </span>
                        {r.repo_dir ? (
                          <code className="font-mono text-[11px] bg-[var(--bg-sunken)] px-1.5 py-0.5 rounded truncate max-w-md">
                            {r.repo_dir}
                          </code>
                        ) : (
                          <button
                            onClick={() => cloneRepo(r)}
                            disabled={cloning === r.id}
                            className="inline-flex items-center gap-1 text-amber-600 hover:text-amber-500 underline disabled:opacity-60"
                          >
                            {cloning === r.id ? (
                              <>
                                <Loader2 className="h-3 w-3 animate-spin" /> cloning…
                              </>
                            ) : (
                              <>
                                <Download className="h-3 w-3" /> clone now
                              </>
                            )}
                          </button>
                        )}
                      </div>
                    </div>
                    <div className="flex flex-col gap-1.5 items-end">
                      <Button
                        variant="primary"
                        size="sm"
                        onClick={() => triggerReview(r)}
                        disabled={reviewing === r.id}
                        title="Scan the repo and file new issues"
                      >
                        {reviewing === r.id ? (
                          <>
                            <Loader2 className="h-3.5 w-3.5 animate-spin" /> Scanning…
                          </>
                        ) : (
                          <>
                            <Search className="h-3.5 w-3.5" /> Find issues
                          </>
                        )}
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => toggleEnabled(r)}
                        disabled={toggling === r.id}
                      >
                        {toggling === r.id ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : r.enabled ? (
                          <>
                            <PowerOff className="h-3.5 w-3.5" /> Pause
                          </>
                        ) : (
                          <>
                            <Power className="h-3.5 w-3.5" /> Enable
                          </>
                        )}
                      </Button>
                      <Button
                        variant={confirmRemove === r.id ? "destructive" : "ghost"}
                        size="sm"
                        onClick={() => removeRepo(r)}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                        {confirmRemove === r.id ? " Really?" : " Remove"}
                      </Button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </section>

      {/* ── Theme ─────────────────────────────────────────────────────────── */}
      <section id="theme">
        <SectionHeading>Theme</SectionHeading>
        <div className="rounded-xl border border-[var(--border)] bg-[var(--bg)] p-4">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-sm font-medium text-[var(--fg)]">
                {dark ? "Dark mode" : "Light mode"}
              </div>
              <div className="text-xs text-[var(--fg-muted)] mt-0.5">
                Default is dark. Stored in localStorage.
              </div>
            </div>
            <button
              onClick={toggleTheme}
              className="inline-flex items-center gap-2 px-3 py-2 rounded-lg border border-[var(--border)] text-sm text-[var(--fg-muted)] hover:text-[var(--fg)] hover:bg-[var(--bg-elev)] transition-colors"
              aria-label={dark ? "Switch to light mode" : "Switch to dark mode"}
            >
              {dark ? (
                <>
                  <Sun className="h-4 w-4" /> Switch to light
                </>
              ) : (
                <>
                  <Moon className="h-4 w-4" /> Switch to dark
                </>
              )}
            </button>
          </div>
        </div>
      </section>

      {/* ── Notifications ─────────────────────────────────────────────────── */}
      <section id="notifications">
        <SectionHeading>Notifications</SectionHeading>
        <div className="rounded-xl border border-[var(--border)] bg-[var(--bg)] p-4">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-sm font-medium text-[var(--fg)]">Sound effects</div>
              <div className="text-xs text-[var(--fg-muted)] mt-0.5">
                Play a sound when a session completes.
              </div>
            </div>
            <button
              onClick={toggleSound}
              className={cn(
                "inline-flex items-center gap-2 px-3 py-2 rounded-lg border text-sm transition-colors",
                soundEnabled
                  ? "border-[var(--accent-soft)] text-[var(--accent)] bg-[var(--accent-soft)]"
                  : "border-[var(--border)] text-[var(--fg-muted)] hover:text-[var(--fg)] hover:bg-[var(--bg-elev)]",
              )}
              aria-label={soundEnabled ? "Disable sound effects" : "Enable sound effects"}
              aria-pressed={soundEnabled}
            >
              {soundEnabled ? (
                <>
                  <Volume2 className="h-4 w-4" /> Enabled
                </>
              ) : (
                <>
                  <VolumeX className="h-4 w-4" /> Disabled
                </>
              )}
            </button>
          </div>
        </div>
      </section>

      {/* ── Secrets ───────────────────────────────────────────────────────── */}
      <section id="secrets">
        <SectionHeading>Environment</SectionHeading>
        <p className="text-sm text-[var(--fg-muted)] mb-4">
          Read-only status. Values are never shown.
        </p>
        <div className="rounded-xl border border-[var(--border)] bg-[var(--bg)] divide-y divide-[var(--border)]">
          {TRACKED_ENV.map((envKey) => {
            const isSet = isEnvSet(envKey, data);
            return (
              <div
                key={envKey}
                className="flex items-center justify-between px-4 py-3"
              >
                <code className="font-mono text-sm text-[var(--fg)]">{envKey}</code>
                <span
                  className={cn(
                    "inline-flex items-center gap-1.5 text-xs",
                    isSet ? "text-emerald-500" : "text-[var(--fg-subtle)]",
                  )}
                >
                  {isSet ? (
                    <>
                      <Eye className="h-3 w-3" /> set
                    </>
                  ) : (
                    <>
                      <EyeOff className="h-3 w-3" /> not set
                    </>
                  )}
                </span>
              </div>
            );
          })}
        </div>

        <div className="mt-6 grid md:grid-cols-2 gap-6">
          <div>
            <h3 className="text-xs uppercase tracking-wider text-[var(--fg-muted)] mb-2">
              Verification policy
            </h3>
            <KV label="Max iterations" value={String(data.verification.maxIterations)} />
            <KV label="Diff line cap" value={String(data.verification.diffMaxLines)} />
            <KV
              label="Critic min confidence"
              value={`${data.verification.criticMinConfidence}/100`}
            />
          </div>
          <div>
            <h3 className="text-xs uppercase tracking-wider text-[var(--fg-muted)] mb-2">
              Budgets
            </h3>
            <KV label="Per run" value={`$${data.budgets.perRunUsd.toFixed(2)}`} />
            <KV label="Per issue" value={`$${data.budgets.perIssueUsd.toFixed(2)}`} />
            <KV label="Per day" value={`$${data.budgets.perDayUsd.toFixed(2)}`} />
          </div>
          <div>
            <h3 className="text-xs uppercase tracking-wider text-[var(--fg-muted)] mb-2">
              Reviewer
            </h3>
            <KV label="Enabled" value={data.reviewer.enabled ? "yes" : "no"} />
            <KV label="Interval" value={`${data.reviewer.intervalMinutes} min`} />
            <KV label="Max issues / run" value={String(data.reviewer.maxIssuesPerRun)} />
            <KV
              label="Dedupe threshold"
              value={data.reviewer.duplicateThreshold.toFixed(2)}
            />
          </div>
          <div>
            <h3 className="text-xs uppercase tracking-wider text-[var(--fg-muted)] mb-2">
              Labels
            </h3>
            {Object.entries(data.labels).map(([k, v]) => (
              <KV key={k} label={k} value={<code className="font-mono text-xs">{v}</code>} />
            ))}
          </div>
        </div>
      </section>
    </div>
  );
}

export default function SettingsPage() {
  return (
    <Suspense fallback={<div className="p-10 text-sm text-[var(--fg-muted)]">Loading…</div>}>
      <SettingsContent />
    </Suspense>
  );
}

// ── Sub-components ────────────────────────────────────────────────────────────

function SectionHeading({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="font-serif text-xl tracking-tight mb-4">{children}</h2>
  );
}

function KV({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between text-sm border-b border-[var(--border)] py-1.5">
      <span className="text-[var(--fg-muted)]">{label}</span>
      <span>{value}</span>
    </div>
  );
}

function AppInstallCTA({
  info,
  hasConnectedRepos,
}: {
  info: AppInfo | undefined;
  hasConnectedRepos: boolean;
}) {
  if (!info) return null;
  if (!info.configured) {
    return (
      <section className="mb-8 rounded-xl border border-[var(--border-strong)] bg-[var(--fg)] text-[var(--bg)] p-5">
        <div className="flex items-center gap-4">
          <Github className="h-6 w-6 shrink-0" />
          <div className="flex-1">
            <div className="font-medium text-base">Set up the GitHub App</div>
            <div className="text-xs opacity-80">
              One click. We register the App for you — you just approve it on
              github.com, then pick a repo to install on.
            </div>
          </div>
          <a
            href="/api/github/app/setup"
            className="inline-flex h-9 items-center justify-center rounded-md bg-[var(--bg)] text-[var(--fg)] px-4 text-sm font-medium hover:opacity-90"
          >
            Create GitHub App
          </a>
        </div>
      </section>
    );
  }
  return (
    <section className="mb-8 rounded-xl border border-[var(--border-strong)] bg-[var(--fg)] text-[var(--bg)] p-5">
      <div className="flex items-center gap-4">
        <Github className="h-6 w-6 shrink-0" />
        <div className="flex-1">
          <div className="font-medium text-base">
            Install <span className="font-mono">{info.appName}</span> on{" "}
            {hasConnectedRepos ? "more repos" : "a repo"}
          </div>
          <div className="text-xs opacity-80">
            One click. Picks the right scopes, no PAT to manage.
          </div>
        </div>
        <a
          href={info.installUrl ?? "#"}
          target="_blank"
          rel="noreferrer"
          className="inline-flex h-9 items-center justify-center rounded-md bg-[var(--bg)] text-[var(--fg)] px-4 text-sm font-medium hover:opacity-90"
        >
          Install
        </a>
      </div>
    </section>
  );
}

function CredStrip({ data, ghAuthOk }: { data: ReposResponse; ghAuthOk: boolean }) {
  return (
    <div className="mb-8 grid grid-cols-1 sm:grid-cols-3 gap-2 text-xs">
      <CredTile
        ok={ghAuthOk}
        label="GitHub auth"
        hint={
          data.githubTokenConfigured
            ? "PAT set as fallback. GitHub App is the preferred path."
            : ghAuthOk
              ? "GitHub App configured."
              : "Install the GitHub App below, or set GITHUB_TOKEN."
        }
      />
      <CredTile
        ok
        label="Claude CLI"
        hint="planner / implementer / critic run through `claude -p` using your CLI login."
      />
      <CredTile
        ok
        label={`Embeddings: ${data.embeddingsBackend}`}
        hint={
          data.embeddingsBackend === "local"
            ? "all-MiniLM-L6-v2 in-process. Set OPENAI_API_KEY + USE_OPENAI_EMBEDDINGS=1 to swap."
            : "OpenAI text-embedding-3-small."
        }
      />
    </div>
  );
}

function CredTile({ ok, label, hint }: { ok: boolean; label: string; hint: string }) {
  return (
    <div
      className={cn(
        "rounded-lg border px-3 py-2",
        ok
          ? "border-emerald-800 bg-emerald-950/40"
          : "border-amber-800 bg-amber-950/40",
      )}
    >
      <div className="flex items-center gap-1.5 font-mono text-[11px]">
        {ok ? (
          <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />
        ) : (
          <XCircle className="h-3.5 w-3.5 text-amber-500" />
        )}
        {label}
      </div>
      <div className="text-[10px] text-[var(--fg-muted)] mt-0.5">{hint}</div>
    </div>
  );
}

// Infer whether an env var is set from the data we already fetch from /api/repos.
function isEnvSet(key: (typeof TRACKED_ENV)[number], data: ReposResponse): boolean {
  switch (key) {
    case "GITHUB_TOKEN":
      return data.githubTokenConfigured;
    case "OPENAI_API_KEY":
      return data.openaiKeyConfigured;
    case "USE_OPENAI_EMBEDDINGS":
      return data.embeddingsBackend === "openai";
    // For these we can't tell from existing data — show as unknown (false)
    default:
      return false;
  }
}
