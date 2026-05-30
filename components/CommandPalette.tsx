"use client";

// 'use client' — keyboard handlers, localStorage, window events.

import { useEffect, useRef, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { Command } from "cmdk";
import useSWR from "swr";
import { fetcher } from "@/lib/api-client";
import { formatRelative } from "@/lib/utils";
import type { RunSummary } from "./RunCard";
import {
  CircleDot,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  Pause,
  Bug,
  Play,
  Moon,
  Sun,
  Settings,
  RefreshCw,
} from "lucide-react";

// ── Types ──────────────────────────────────────────────────────────────────────

type Issue = {
  number: number;
  title: string;
  repo: string;
  source: "bot-found" | "bot-please" | "both";
  run_id: number | null;
  run_status: string | null;
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function statusIcon(status: string) {
  switch (status) {
    case "pr-opened":
    case "succeeded":
      return <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />;
    case "needs-review":
      return <AlertTriangle className="h-3.5 w-3.5 text-amber-500" />;
    case "failed":
      return <XCircle className="h-3.5 w-3.5 text-red-500" />;
    case "abandoned":
      return <Pause className="h-3.5 w-3.5 text-zinc-400" />;
    default:
      return <CircleDot className="h-3.5 w-3.5 text-sky-500 animate-pulse" />;
  }
}

function useDarkMode() {
  const [dark, setDark] = useState(true);

  useEffect(() => {
    const stored = localStorage.getItem("otis-theme");
    if (stored) {
      const isDark = stored === "dark";
      setDark(isDark);
      document.documentElement.classList.toggle("dark", isDark);
    }
  }, []);

  function toggle() {
    setDark((prev) => {
      const next = !prev;
      document.documentElement.classList.toggle("dark", next);
      localStorage.setItem("otis-theme", next ? "dark" : "light");
      return next;
    });
  }

  return { dark, toggle };
}

// ── Component ─────────────────────────────────────────────────────────────────

export function CommandPalette() {
  const [open, setOpen] = useState(false);
  const router = useRouter();
  const { dark, toggle: toggleTheme } = useDarkMode();
  const inputRef = useRef<HTMLInputElement>(null);

  const { data: runsData } = useSWR<{ runs: RunSummary[] }>(
    open ? "/api/runs?limit=20" : null,
    fetcher,
  );
  const { data: issuesData } = useSWR<{ issues: Issue[] }>(
    open ? "/api/issues" : null,
    fetcher,
  );

  const runs = runsData?.runs ?? [];
  const issues = issuesData?.issues ?? [];

  const openPalette = useCallback(() => {
    setOpen(true);
  }, []);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        setOpen((prev) => !prev);
      }
      if (e.key === "Escape") {
        setOpen(false);
      }
    }
    function onEvent() {
      openPalette();
    }
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("otis:open-palette", onEvent);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("otis:open-palette", onEvent);
    };
  }, [openPalette]);

  function navigate(href: string) {
    setOpen(false);
    router.push(href);
  }

  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Command palette"
      className="fixed inset-0 z-50 flex items-start justify-center pt-[15vh]"
    >
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/40 backdrop-blur-sm"
        onClick={() => setOpen(false)}
        aria-hidden="true"
      />

      {/* Panel */}
      <div className="relative w-full max-w-xl mx-4 rounded-xl border border-[var(--border-strong)] bg-[var(--bg-elev)] shadow-2xl overflow-hidden">
        <Command
          className="flex flex-col"
          onKeyDown={(e) => {
            if (e.key === "Escape") setOpen(false);
          }}
        >
          <div className="flex items-center px-4 border-b border-[var(--border)]">
            <Command.Input
              ref={inputRef}
              autoFocus
              placeholder="Search sessions, issues, actions…"
              className="h-12 flex-1 bg-transparent text-sm text-[var(--fg)] placeholder:text-[var(--fg-subtle)] focus:outline-none"
              aria-label="Search"
            />
          </div>

          <Command.List className="max-h-[360px] overflow-y-auto py-2">
            <Command.Empty className="py-8 text-center text-sm text-[var(--fg-muted)]">
              No results.
            </Command.Empty>

            {/* Sessions */}
            {runs.length > 0 && (
              <Command.Group
                heading="Sessions"
                className="[&_[cmdk-group-heading]]:px-3 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-[10px] [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-wider [&_[cmdk-group-heading]]:text-[var(--fg-subtle)]"
              >
                {runs.map((r) => (
                  <Command.Item
                    key={r.id}
                    value={`session ${r.id} ${r.issue_title ?? ""} ${r.repo} ${r.status}`}
                    onSelect={() => navigate(`/sessions/${r.id}`)}
                    className="flex items-center gap-3 px-3 py-2.5 text-sm cursor-pointer rounded-md mx-1 aria-selected:bg-[var(--bg-sunken)] text-[var(--fg)]"
                  >
                    <span className="shrink-0">{statusIcon(r.status)}</span>
                    <span className="flex-1 min-w-0 truncate">
                      {r.issue_title ?? (r.type === "review" ? "Codebase review" : `Run #${r.id}`)}
                    </span>
                    <span className="shrink-0 text-[11px] font-mono text-[var(--fg-muted)]">
                      {r.repo}
                    </span>
                    <span className="shrink-0 text-[11px] text-[var(--fg-subtle)]">
                      {formatRelative(r.started_at)}
                    </span>
                  </Command.Item>
                ))}
              </Command.Group>
            )}

            {/* Issues */}
            {issues.length > 0 && (
              <Command.Group
                heading="Issues"
                className="[&_[cmdk-group-heading]]:px-3 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-[10px] [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-wider [&_[cmdk-group-heading]]:text-[var(--fg-subtle)]"
              >
                {issues.slice(0, 15).map((i) => (
                  <Command.Item
                    key={`${i.repo}#${i.number}`}
                    value={`issue ${i.number} ${i.title} ${i.repo}`}
                    onSelect={() => navigate("/inbox?tab=queue")}
                    className="flex items-center gap-3 px-3 py-2.5 text-sm cursor-pointer rounded-md mx-1 aria-selected:bg-[var(--bg-sunken)] text-[var(--fg)]"
                  >
                    <Bug className="h-3.5 w-3.5 shrink-0 text-[var(--fg-muted)]" />
                    <span className="flex-1 min-w-0 truncate">{i.title}</span>
                    <span className="shrink-0 text-[11px] font-mono text-[var(--fg-muted)]">
                      {i.repo}#{i.number}
                    </span>
                  </Command.Item>
                ))}
              </Command.Group>
            )}

            {/* Actions */}
            <Command.Group
              heading="Actions"
              className="[&_[cmdk-group-heading]]:px-3 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-[10px] [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-wider [&_[cmdk-group-heading]]:text-[var(--fg-subtle)]"
            >
              <Command.Item
                value="start new session home"
                onSelect={() => navigate("/")}
                className="flex items-center gap-3 px-3 py-2.5 text-sm cursor-pointer rounded-md mx-1 aria-selected:bg-[var(--bg-sunken)] text-[var(--fg)]"
              >
                <Play className="h-3.5 w-3.5 shrink-0 text-[var(--fg-muted)]" />
                Start a new session
                <kbd className="ml-auto font-mono text-[10px] text-[var(--fg-subtle)] border border-[var(--border)] px-1.5 py-0.5 rounded">
                  &#8629;
                </kbd>
              </Command.Item>
              <Command.Item
                value="toggle theme dark light mode"
                onSelect={() => {
                  toggleTheme();
                  setOpen(false);
                }}
                className="flex items-center gap-3 px-3 py-2.5 text-sm cursor-pointer rounded-md mx-1 aria-selected:bg-[var(--bg-sunken)] text-[var(--fg)]"
              >
                {dark ? (
                  <Sun className="h-3.5 w-3.5 shrink-0 text-[var(--fg-muted)]" />
                ) : (
                  <Moon className="h-3.5 w-3.5 shrink-0 text-[var(--fg-muted)]" />
                )}
                {dark ? "Switch to light mode" : "Switch to dark mode"}
              </Command.Item>
              <Command.Item
                value="open settings"
                onSelect={() => navigate("/settings")}
                className="flex items-center gap-3 px-3 py-2.5 text-sm cursor-pointer rounded-md mx-1 aria-selected:bg-[var(--bg-sunken)] text-[var(--fg)]"
              >
                <Settings className="h-3.5 w-3.5 shrink-0 text-[var(--fg-muted)]" />
                Open settings
              </Command.Item>
              <Command.Item
                value="reload refresh page"
                onSelect={() => {
                  setOpen(false);
                  window.location.reload();
                }}
                className="flex items-center gap-3 px-3 py-2.5 text-sm cursor-pointer rounded-md mx-1 aria-selected:bg-[var(--bg-sunken)] text-[var(--fg)]"
              >
                <RefreshCw className="h-3.5 w-3.5 shrink-0 text-[var(--fg-muted)]" />
                Reload
              </Command.Item>
            </Command.Group>
          </Command.List>
        </Command>
      </div>
    </div>
  );
}
