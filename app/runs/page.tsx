"use client";

import { useState } from "react";
import useSWR from "swr";
import { fetcher } from "@/lib/api-client";
import { RunCard, type RunSummary } from "@/components/RunCard";
import { Badge } from "@/components/ui/badge";
import { formatUsd } from "@/lib/utils";

const STATUSES = [
  "all",
  "pr-opened",
  "succeeded",
  "needs-review",
  "iterating",
  "implementing",
  "abandoned",
  "failed",
] as const;

type Rollup = {
  total: number;
  shipped: number;
  needs_review: number;
  abandoned: number;
  failed: number;
  cost_usd: number;
};

export default function Runs() {
  const [status, setStatus] = useState<(typeof STATUSES)[number]>("all");
  const qs = status === "all" ? "" : `?status=${status}`;
  const { data } = useSWR<{ runs: RunSummary[]; today: Rollup }>(
    `/api/runs${qs}`,
    fetcher,
    { refreshInterval: 4000 },
  );
  const runs = data?.runs ?? [];
  const today: Rollup = data?.today ?? {
    total: 0,
    shipped: 0,
    needs_review: 0,
    abandoned: 0,
    failed: 0,
    cost_usd: 0,
  };

  return (
    <div className="max-w-5xl mx-auto px-8 py-10">
      <header className="mb-6">
        <h1 className="font-serif text-3xl tracking-tight">All runs</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Every implementer + reviewer run, newest first.
        </p>
      </header>

      {/* C7: 24h rollup strip — at-a-glance ops view. */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 mb-6 text-xs">
        <Stat label="Last 24h" value={today.total} />
        <Stat label="Shipped" value={today.shipped} tone="emerald" />
        <Stat label="Needs review" value={today.needs_review} tone="amber" />
        <Stat label="Failed" value={today.failed} tone="red" />
        <Stat label="Spend" value={formatUsd(today.cost_usd)} />
      </div>

      <div className="flex flex-wrap gap-1.5 mb-6">
        {STATUSES.map((s) => (
          <button
            key={s}
            onClick={() => setStatus(s)}
            className={`text-xs rounded-full px-3 py-1 border transition-colors ${
              status === s
                ? "bg-foreground text-background border-foreground"
                : "bg-background hover:bg-muted border-border text-muted-foreground"
            }`}
          >
            {s}
          </button>
        ))}
        <div className="ml-auto">
          <Badge variant="outline">{runs.length} shown</Badge>
        </div>
      </div>
      <div className="space-y-3">
        {runs.map((r) => (
          <RunCard key={r.id} run={r} />
        ))}
        {runs.length === 0 && (
          <div className="rounded-lg border border-dashed border-border p-10 text-center text-sm text-muted-foreground">
            No runs match this filter yet.
          </div>
        )}
      </div>
    </div>
  );
}

function Stat({
  label,
  value,
  tone,
}: {
  label: string;
  value: number | string;
  tone?: "emerald" | "amber" | "red";
}) {
  const accent =
    tone === "emerald"
      ? "border-emerald-200"
      : tone === "amber"
        ? "border-amber-200"
        : tone === "red"
          ? "border-red-200"
          : "border-border";
  return (
    <div className={`rounded-lg border ${accent} bg-background px-3 py-2`}>
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
        {label}
      </div>
      <div className="text-lg font-semibold tabular-nums">{value}</div>
    </div>
  );
}
