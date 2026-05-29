"use client";

import useSWR from "swr";
import { fetcher } from "@/lib/api-client";
import { RunCard, type RunSummary } from "@/components/RunCard";
import { formatUsd } from "@/lib/utils";
import { CheckCircle2, AlertTriangle, XCircle, Pause, CircleDot, DollarSign } from "lucide-react";

type RollupRow = {
  total: number;
  shipped: number;
  needs_review: number;
  abandoned: number;
  failed: number;
  cost_usd: number;
};

export default function LiveFeed() {
  const { data } = useSWR<{ runs: RunSummary[]; today: RollupRow }>(
    "/api/runs?limit=80",
    fetcher,
    { refreshInterval: 2000 },
  );
  const runs = data?.runs ?? [];
  const today: RollupRow = data?.today ?? {
    total: 0,
    shipped: 0,
    needs_review: 0,
    abandoned: 0,
    failed: 0,
    cost_usd: 0,
  };

  const active = runs.filter((r) =>
    ["queued", "planning", "implementing", "verifying", "iterating"].includes(
      r.status,
    ),
  );
  const recent = runs.filter((r) => !active.includes(r));

  return (
    <div className="max-w-6xl mx-auto px-8 py-10">
      <header className="mb-8 flex items-end justify-between gap-6">
        <div>
          <h1 className="font-serif text-3xl tracking-tight">Live</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            What the bot is doing right now, plus the past 24 hours.
          </p>
        </div>
      </header>

      <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-8">
        <StatTile label="Active" value={active.length} icon={<CircleDot className="h-3.5 w-3.5 text-sky-600" />} accent="sky" />
        <StatTile label="Shipped (24h)" value={today.shipped} icon={<CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" />} accent="emerald" />
        <StatTile label="Needs review" value={today.needs_review} icon={<AlertTriangle className="h-3.5 w-3.5 text-amber-600" />} accent="amber" />
        <StatTile label="Abandoned" value={today.abandoned} icon={<Pause className="h-3.5 w-3.5 text-zinc-500" />} />
        <StatTile label="Failed" value={today.failed} icon={<XCircle className="h-3.5 w-3.5 text-red-600" />} accent="red" />
      </div>

      <div className="mb-8">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-medium tracking-wide uppercase text-muted-foreground">
            Active runs
          </h2>
          <div className="text-xs text-muted-foreground inline-flex items-center gap-1.5">
            <DollarSign className="h-3 w-3" />
            {formatUsd(today.cost_usd)} spent (last 24h)
          </div>
        </div>
        {active.length === 0 ? (
          <div className="rounded-lg border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
            Bot is idle. Drop a <code className="font-mono text-xs bg-muted px-1.5 py-0.5 rounded">bot-please</code> label on an open issue and it will start within ~60s.
          </div>
        ) : (
          <div className="space-y-3">
            {active.map((r) => (
              <RunCard key={r.id} run={r} />
            ))}
          </div>
        )}
      </div>

      <div>
        <h2 className="text-sm font-medium tracking-wide uppercase text-muted-foreground mb-3">
          Recent completions
        </h2>
        <div className="space-y-3">
          {recent.slice(0, 20).map((r) => (
            <RunCard key={r.id} run={r} />
          ))}
        </div>
      </div>
    </div>
  );
}

function StatTile({
  label,
  value,
  icon,
  accent,
}: {
  label: string;
  value: number;
  icon: React.ReactNode;
  accent?: "sky" | "emerald" | "amber" | "red";
}) {
  const accentBorder =
    accent === "sky"
      ? "border-sky-200"
      : accent === "emerald"
        ? "border-emerald-200"
        : accent === "amber"
          ? "border-amber-200"
          : accent === "red"
            ? "border-red-200"
            : "border-border";
  return (
    <div className={`rounded-lg border ${accentBorder} bg-background p-3`}>
      <div className="flex items-center justify-between">
        <div className="text-[11px] uppercase tracking-wider text-muted-foreground">
          {label}
        </div>
        {icon}
      </div>
      <div className="mt-1 text-2xl font-semibold tabular-nums">{value}</div>
    </div>
  );
}
