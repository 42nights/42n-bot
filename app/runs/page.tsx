"use client";

import { useState } from "react";
import useSWR from "swr";
import { fetcher } from "@/lib/api-client";
import { RunCard, type RunSummary } from "@/components/RunCard";
import { Badge } from "@/components/ui/badge";

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

export default function Runs() {
  const [status, setStatus] = useState<(typeof STATUSES)[number]>("all");
  const qs = status === "all" ? "" : `?status=${status}`;
  const { data } = useSWR<{ runs: RunSummary[] }>(
    `/api/runs${qs}`,
    fetcher,
    { refreshInterval: 4000 },
  );
  const runs = data?.runs ?? [];
  return (
    <div className="max-w-5xl mx-auto px-8 py-10">
      <header className="mb-6">
        <h1 className="font-serif text-3xl tracking-tight">All runs</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Every implementer + reviewer run, newest first.
        </p>
      </header>
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
