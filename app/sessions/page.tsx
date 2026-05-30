"use client";

import { Suspense } from "react";
import useSWR from "swr";
import Link from "next/link";
import { fetcher } from "@/lib/api-client";
import { useRepoScope } from "@/lib/repo-scope";
import { LiveDot } from "@/components/icons/LiveDot";
import { OtisMark } from "@/components/icons/OtisMark";
import { cn } from "@/lib/utils";

type Run = {
  id: number;
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
      fallback={<div className="p-10 text-sm text-[var(--fg-muted)]">Loading…</div>}
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
          <h2 className="text-[11px] uppercase tracking-[0.18em] text-[var(--fg-muted)] mb-3">
            Live
          </h2>
          <div className="space-y-2">
            {active.map((r) => (
              <SessionRow key={r.id} run={r} live />
            ))}
          </div>
        </section>
      )}

      <section>
        <h2 className="text-[11px] uppercase tracking-[0.18em] text-[var(--fg-muted)] mb-3">
          History
        </h2>
        {done.length === 0 ? (
          <div className="rounded-lg border border-dashed border-border p-10 text-center text-sm text-[var(--fg-muted)]">
            No completed sessions yet.
          </div>
        ) : (
          <div className="space-y-2">
            {done.map((r) => (
              <SessionRow key={r.id} run={r} />
            ))}
          </div>
        )}
      </section>
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
