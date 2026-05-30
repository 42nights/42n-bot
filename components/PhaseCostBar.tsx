"use client";

// Client needed: SWR polling, click-to-expand interaction, useState.

import { useState } from "react";
import useSWR from "swr";
import { fetcher } from "@/lib/api-client";
import { cn } from "@/lib/utils";
import { formatDuration, formatUsd } from "@/lib/utils";
import { ChevronDown } from "lucide-react";

type RollupEntry = {
  phase: string;
  totalCostUsd: number;
  totalMs: number;
  attempts: number;
  allOk: boolean;
};

type PhasesResponse = {
  phases: unknown[];
  rollup: RollupEntry[];
};

// Colors per phase — CSS var strings evaluated at runtime.
const PHASE_COLOR: Record<string, string> = {
  understand: "var(--plan)",
  reproduce: "var(--warn)",
  design: "var(--plan)",
  plan: "var(--accent)",
  implement: "color-mix(in oklab, var(--accent) 70%, var(--bg))",
  verify: "var(--fg-muted)",
  replan: "var(--warn)",
};

function phaseColor(phase: string): string {
  return PHASE_COLOR[phase] ?? "var(--fg-subtle)";
}

export function PhaseCostBar({ runId }: { runId: number }) {
  const { data } = useSWR<PhasesResponse>(
    `/api/runs/${runId}/phases`,
    fetcher,
    { refreshInterval: 4000 },
  );
  const [expanded, setExpanded] = useState<string | null>(null);
  const [open, setOpen] = useState(false);

  const rollup = data?.rollup ?? [];
  if (rollup.length === 0) return null;

  const totalCost = rollup.reduce((s, r) => s + r.totalCostUsd, 0);
  const totalMs = rollup.reduce((s, r) => s + r.totalMs, 0);
  // Use cost for segment widths; fall back to ms if all costs are 0.
  const useMs = totalCost === 0;
  const totalBasis = useMs ? totalMs : totalCost;

  return (
    <div className="border-b border-[var(--border)] bg-[var(--bg-sunken)]">
      {/* Collapsed toggle row */}
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full px-6 py-1.5 flex items-center gap-3 text-xs text-[var(--fg-muted)] hover:text-[var(--fg)] transition-colors group"
        aria-expanded={open}
        aria-label="Toggle per-phase cost breakdown"
      >
        <span className="shrink-0">
          Spent{" "}
          <span className="font-mono font-medium text-[var(--fg)]">
            {formatUsd(totalCost)}
          </span>{" "}
          across{" "}
          <span className="font-medium text-[var(--fg)]">{rollup.length}</span>{" "}
          phase{rollup.length !== 1 ? "s" : ""}
        </span>

        {/* Inline mini stacked bar */}
        <div
          className="flex-1 h-1.5 rounded-full overflow-hidden bg-[var(--border)] hidden sm:flex"
          aria-hidden="true"
        >
          {rollup.map((r) => {
            const pct =
              totalBasis > 0
                ? ((useMs ? r.totalMs : r.totalCostUsd) / totalBasis) * 100
                : 100 / rollup.length;
            return (
              <div
                key={r.phase}
                style={{ width: `${pct}%`, background: phaseColor(r.phase) }}
                className="h-full"
              />
            );
          })}
        </div>

        <ChevronDown
          className={cn(
            "h-3.5 w-3.5 shrink-0 transition-transform",
            open && "rotate-180",
          )}
        />
      </button>

      {/* Expanded detail */}
      {open && (
        <div className="px-6 pb-4">
          {/* Full-width clickable bar */}
          <div
            className="flex h-6 rounded overflow-hidden mb-3 cursor-pointer"
            role="group"
            aria-label="Phase cost segments"
          >
            {rollup.map((r) => {
              const pct =
                totalBasis > 0
                  ? ((useMs ? r.totalMs : r.totalCostUsd) / totalBasis) * 100
                  : 100 / rollup.length;
              const isActive = expanded === r.phase;
              return (
                <button
                  key={r.phase}
                  onClick={() =>
                    setExpanded((prev) => (prev === r.phase ? null : r.phase))
                  }
                  style={{
                    width: `${pct}%`,
                    background: phaseColor(r.phase),
                    opacity: isActive ? 1 : 0.75,
                  }}
                  className="h-full transition-opacity hover:opacity-100 focus:outline-none focus:ring-1 focus:ring-[var(--accent)] relative"
                  title={r.phase}
                  aria-pressed={isActive}
                  aria-label={`${r.phase}: ${formatUsd(r.totalCostUsd)}`}
                />
              );
            })}
          </div>

          {/* Phase labels */}
          <div className="flex flex-wrap gap-2 mb-3">
            {rollup.map((r) => (
              <button
                key={r.phase}
                onClick={() =>
                  setExpanded((prev) => (prev === r.phase ? null : r.phase))
                }
                className={cn(
                  "inline-flex items-center gap-1.5 px-2 py-1 rounded text-[11px] border transition-colors",
                  expanded === r.phase
                    ? "border-[var(--border-strong)] bg-[var(--bg-elev)] text-[var(--fg)]"
                    : "border-transparent text-[var(--fg-muted)] hover:text-[var(--fg)]",
                )}
              >
                <span
                  className="inline-block h-2 w-2 rounded-full shrink-0"
                  style={{ background: phaseColor(r.phase) }}
                  aria-hidden="true"
                />
                {r.phase}
              </button>
            ))}
          </div>

          {/* Detail row for selected phase */}
          {expanded && (() => {
            const r = rollup.find((x) => x.phase === expanded);
            if (!r) return null;
            return (
              <div className="rounded-lg border border-[var(--border)] bg-[var(--bg-elev)] px-4 py-3 grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
                <div>
                  <div className="text-[var(--fg-muted)] mb-0.5 uppercase tracking-wide text-[10px]">
                    Phase
                  </div>
                  <div className="font-medium capitalize">{r.phase}</div>
                </div>
                <div>
                  <div className="text-[var(--fg-muted)] mb-0.5 uppercase tracking-wide text-[10px]">
                    Cost
                  </div>
                  <div className="font-mono font-medium">
                    {formatUsd(r.totalCostUsd)}
                  </div>
                </div>
                <div>
                  <div className="text-[var(--fg-muted)] mb-0.5 uppercase tracking-wide text-[10px]">
                    Duration
                  </div>
                  <div className="font-mono">{formatDuration(r.totalMs)}</div>
                </div>
                <div>
                  <div className="text-[var(--fg-muted)] mb-0.5 uppercase tracking-wide text-[10px]">
                    Attempts
                  </div>
                  <div className="font-mono flex items-center gap-1.5">
                    {r.attempts}
                    <span
                      className={cn(
                        "inline-block h-1.5 w-1.5 rounded-full",
                        r.allOk
                          ? "bg-[var(--accent)]"
                          : "bg-[var(--fail)]",
                      )}
                      aria-label={r.allOk ? "all ok" : "some failed"}
                    />
                  </div>
                </div>
              </div>
            );
          })()}
        </div>
      )}
    </div>
  );
}
