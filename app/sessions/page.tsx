"use client";

import { Suspense } from "react";
import useSWR from "swr";
import Link from "next/link";
import { motion, AnimatePresence } from "framer-motion";
import { fetcher } from "@/lib/api-client";
import { useRepoScope } from "@/lib/repo-scope";
import { LiveDot } from "@/components/icons/LiveDot";
import { OtisMark } from "@/components/icons/OtisMark";
import { Skeleton } from "@/components/ui/Skeleton";
import { cn } from "@/lib/utils";

const spring = { type: "spring" as const, stiffness: 320, damping: 36, mass: 0.8 };

type Run = {
  id: string;
  type: "implement" | "review" | "system";
  repo: string;
  issue_number: number | null;
  issue_title: string | null;
  status: string;
  attempts: number;
  cost_usd: number;
  started_at: number;
  finished_at: number | null;
  pr_number: number | null;
  pr_url: string | null;
};

const ACTIVE = new Set([
  "queued",
  "planning",
  "implementing",
  "verifying",
  "iterating",
]);

export default function SessionsPage() {
  return (
    <Suspense
      fallback={
        <div className="max-w-5xl mx-auto px-8 py-12 space-y-6">
          <Skeleton className="h-8 w-40" />
          <Skeleton className="h-4 w-64" />
          <div className="space-y-2">
            {Array.from({ length: 5 }).map((_, i) => (
              <Skeleton key={i} className="h-16 w-full" />
            ))}
          </div>
        </div>
      }
    >
      <SessionsList />
    </Suspense>
  );
}

function SessionsList() {
  const { scope, queryParam } = useRepoScope();
  const { data } = useSWR<{ runs: Run[] }>(
    `/api/runs?limit=80${queryParam}`,
    fetcher,
    { refreshInterval: 3000 },
  );
  const runs = data?.runs ?? [];
  const active = runs.filter((r) => ACTIVE.has(r.status));
  const done = runs.filter((r) => !ACTIVE.has(r.status));

  return (
    <div className="max-w-5xl mx-auto px-8 py-12">
      <header className="mb-8">
        <h1 className="font-serif text-3xl tracking-tight">Sessions</h1>
        <p className="mt-2 text-sm text-[var(--fg-muted)]">
          {scope === "all"
            ? "Every session Otis has run across every connected repo."
            : `Sessions for ${scope}.`}
        </p>
      </header>

      {active.length > 0 && (
        <section className="mb-10">
          <h2 className="text-[11px] uppercase tracking-[0.18em] text-[var(--fg-muted)] mb-3 flex items-center gap-2">
            <span className="otis-live-dot inline-block w-1.5 h-1.5 rounded-full bg-[var(--accent)]" />
            Live
          </h2>
          <div className="space-y-2">
            <AnimatePresence initial={false}>
              {active.map((r) => (
                <motion.div
                  key={r.id}
                  layoutId={`session-row-${r.id}`}
                  initial={{ opacity: 0, y: -6 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -6 }}
                  transition={spring}
                >
                  <SessionRow run={r} live />
                </motion.div>
              ))}
            </AnimatePresence>
          </div>
        </section>
      )}

      <section>
        <h2 className="text-[11px] uppercase tracking-[0.18em] text-[var(--fg-muted)] mb-3">
          History
        </h2>
        {done.length === 0 && active.length === 0 ? (
          <SessionsEmptyState />
        ) : done.length === 0 ? (
          <div className="rounded-lg border border-dashed border-border p-10 text-center text-sm text-[var(--fg-muted)]">
            No completed sessions yet.
          </div>
        ) : (
          <div className="space-y-2">
            <AnimatePresence initial={false}>
              {done.map((r, i) => (
                <motion.div
                  key={r.id}
                  layoutId={`session-row-${r.id}`}
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, scale: 0.98 }}
                  transition={{ ...spring, delay: Math.min(i * 0.03, 0.18) }}
                >
                  <SessionRow run={r} />
                </motion.div>
              ))}
            </AnimatePresence>
          </div>
        )}
      </section>
    </div>
  );
}

function SessionsEmptyState() {
  return (
    <div className="flex flex-col items-center justify-center py-20 gap-4 text-center">
      <motion.div
        className="relative"
        animate={{ boxShadow: ["0 0 0 0 transparent", "0 0 0 8px color-mix(in oklab, var(--accent) 20%, transparent)", "0 0 0 0 transparent"] }}
        transition={{ duration: 2.4, repeat: Infinity, ease: "easeInOut" }}
      >
        <OtisMark className="h-16 w-16 opacity-40" />
      </motion.div>
      <div className="space-y-1.5">
        <p className="text-sm font-medium text-[var(--fg-muted)]">No sessions yet</p>
        <p className="text-xs text-[var(--fg-subtle)] max-w-64">
          Drop a <code className="font-mono text-[11px] bg-[var(--bg-sunken)] px-1 rounded">bot-please</code> label on an issue, or send a task from the home page.
        </p>
      </div>
      <Link
        href="/"
        className="mt-2 inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-[var(--accent)] text-[var(--accent-fg)] text-xs font-medium hover:opacity-90 transition-opacity"
      >
        Send a task
      </Link>
    </div>
  );
}

function SessionRow({ run, live = false }: { run: Run; live?: boolean }) {
  const subject =
    run.issue_title ??
    (run.type === "review" ? "Scanning the repo" : `Run #${run.id}`);
  return (
    <Link
      href={`/sessions/${run.id}`}
      className={cn(
        "block px-4 py-3 rounded-lg border transition-colors",
        live
          ? "border-[var(--accent-soft)] bg-[var(--bg-elev)] hover:bg-[var(--bg-elev)]"
          : "border-border bg-[var(--bg)] hover:bg-[var(--bg-elev)]",
      )}
    >
      <div className="flex items-center gap-3">
        <OtisMark className="h-7 w-7 shrink-0" />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-sm text-[var(--fg)] truncate">{subject}</span>
            {live && <LiveDot active />}
          </div>
          <div className="mt-0.5 flex items-center gap-2 text-[11px] text-[var(--fg-muted)] font-mono">
            <span>{run.repo}</span>
            {run.issue_number != null && <span>· #{run.issue_number}</span>}
            <span>·</span>
            <span>{run.status}</span>
            {run.pr_number != null && (
              <span className="text-[var(--accent)]">· PR #{run.pr_number}</span>
            )}
          </div>
        </div>
        <div className="text-right shrink-0 text-[11px] text-[var(--fg-muted)]">
          <div className="font-mono tabular-nums">${run.cost_usd.toFixed(2)}</div>
          <div className="font-mono">{relative(run.started_at)}</div>
        </div>
      </div>
    </Link>
  );
}

function relative(ts: number): string {
  const s = Math.round((Date.now() - ts) / 1000);
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.round(s / 60)}m ago`;
  if (s < 86400) return `${Math.round(s / 3600)}h ago`;
  return `${Math.round(s / 86400)}d ago`;
}
