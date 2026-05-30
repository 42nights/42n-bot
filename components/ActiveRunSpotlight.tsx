"use client";

import Link from "next/link";
import useSWR from "swr";
import { fetcher } from "@/lib/api-client";
import { formatRelative, formatUsd } from "@/lib/utils";
import {
  Sparkles,
  FileCode,
  Hammer,
  CheckCircle2,
  AlertTriangle,
  CircleDot,
} from "lucide-react";
import type { RunSummary } from "./RunCard";

type Plan = {
  files_to_change?: Array<{ path: string; kind: string; why: string }>;
  tests_to_add_or_update?: Array<{ path: string; describes: string }>;
  user_visible_change?: string;
  complexity?: string;
};

type RunDetail = {
  run: RunSummary;
  events: Array<{
    id: number;
    ts: number;
    kind: string;
    payload_json: string;
  }>;
  verdicts: Array<{
    attempt: number;
    pass: number;
    failure_summary: string | null;
    checks_json: string;
  }>;
};

const KIND_ICON: Record<string, string> = {
  "plan.started": "📐",
  "plan.completed": "📋",
  "implement.started": "✏️",
  "implement.tool_use": "🔧",
  "implement.text_delta": "💭",
  "implement.completed": "✅",
  "verification.started": "🧪",
  "verification.check_started": "🔍",
  "verification.check_completed": "✓",
  "verification.completed": "🎯",
  "iteration.started": "🔁",
  "pr.opened": "🚀",
  "pr.needs_review": "👀",
  "claude.subprocess.spawned": "⚡",
  "claude.budget_exceeded": "💸",
  "review.started": "🔎",
  "review.proposed": "📝",
};

export function ActiveRunSpotlight({ run }: { run: RunSummary }) {
  const { data } = useSWR<RunDetail>(
    `/api/runs/${run.id}`,
    fetcher,
    { refreshInterval: 1500 },
  );

  const events = data?.events ?? [];
  const plan = parsePlan(events);
  const touchedFiles = collectTouchedFiles(events);
  const recentEvents = events.slice(-6).reverse();
  const ageS = Math.round((Date.now() - run.started_at) / 1000);

  return (
    <Link
      href={`/runs/${run.id}`}
      className="block rounded-2xl border-2 border-violet-300 bg-gradient-to-br from-violet-50/60 via-background to-background p-5 hover:shadow-lg transition-shadow"
    >
      <div className="flex items-start justify-between gap-4 mb-4">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 mb-1">
            <CircleDot className="h-4 w-4 text-violet-600 animate-pulse" />
            <span className="text-[10px] uppercase tracking-[0.18em] text-violet-700 font-medium">
              {run.status} · {ageS}s in · run #{run.id}
            </span>
          </div>
          <h2 className="font-serif text-xl tracking-tight truncate">
            {run.issue_title ?? (run.type === "review" ? "Scanning the repo" : "Working")}
          </h2>
          <div className="mt-1 text-xs text-muted-foreground font-mono">
            {run.repo}
            {run.issue_number != null && ` #${run.issue_number}`}
          </div>
        </div>
        <div className="text-right shrink-0">
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
            Spent
          </div>
          <div className="text-lg font-semibold tabular-nums">
            {formatUsd(run.cost_usd)}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
        <div>
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-2 flex items-center gap-1.5">
            <Sparkles className="h-3 w-3" /> Plan
          </div>
          {plan ? (
            <ul className="space-y-1.5 text-xs">
              {plan.user_visible_change && (
                <li className="text-foreground/80 italic">
                  {plan.user_visible_change}
                </li>
              )}
              {plan.files_to_change?.slice(0, 4).map((f, i) => (
                <li key={i} className="flex items-start gap-2">
                  <span
                    className={
                      f.kind === "create"
                        ? "text-emerald-600"
                        : f.kind === "delete"
                          ? "text-red-600"
                          : "text-sky-600"
                    }
                  >
                    {f.kind === "create" ? "+" : f.kind === "delete" ? "−" : "~"}
                  </span>
                  <code className="font-mono text-[11px]">{f.path}</code>
                </li>
              ))}
              {(plan.files_to_change?.length ?? 0) > 4 && (
                <li className="text-[11px] text-muted-foreground">
                  +{(plan.files_to_change?.length ?? 0) - 4} more files
                </li>
              )}
            </ul>
          ) : (
            <div className="text-xs text-muted-foreground italic">
              Planning…
            </div>
          )}

          {touchedFiles.length > 0 && (
            <>
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground mt-4 mb-2 flex items-center gap-1.5">
                <FileCode className="h-3 w-3" /> Touched
              </div>
              <div className="flex flex-wrap gap-1.5">
                {touchedFiles.slice(0, 8).map((f) => (
                  <code
                    key={f}
                    className="font-mono text-[10px] bg-muted px-1.5 py-0.5 rounded"
                  >
                    {basename(f)}
                  </code>
                ))}
                {touchedFiles.length > 8 && (
                  <span className="text-[10px] text-muted-foreground">
                    +{touchedFiles.length - 8}
                  </span>
                )}
              </div>
            </>
          )}
        </div>

        <div>
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-2 flex items-center gap-1.5">
            <Hammer className="h-3 w-3" /> Live activity
          </div>
          <ul className="space-y-1 font-mono text-[11px]">
            {recentEvents.length === 0 ? (
              <li className="text-muted-foreground italic">starting…</li>
            ) : (
              recentEvents.map((e) => (
                <li
                  key={e.id}
                  className="flex items-start gap-2 text-foreground/80"
                >
                  <span className="shrink-0">
                    {KIND_ICON[e.kind] ?? "·"}
                  </span>
                  <span className="flex-1 truncate">
                    <span className="text-muted-foreground">{e.kind}</span>{" "}
                    {summarizePayload(e.kind, e.payload_json)}
                  </span>
                  <span className="shrink-0 text-muted-foreground">
                    {formatRelative(e.ts)}
                  </span>
                </li>
              ))
            )}
          </ul>
        </div>
      </div>

      <VerdictStrip verdicts={data?.verdicts ?? []} />
    </Link>
  );
}

function VerdictStrip({
  verdicts,
}: {
  verdicts: RunDetail["verdicts"];
}) {
  if (verdicts.length === 0) return null;
  const latest = verdicts[verdicts.length - 1];
  const checks = safeParseChecks(latest.checks_json);
  if (checks.length === 0) return null;
  return (
    <div className="mt-4 pt-4 border-t border-violet-200">
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-2">
        Verification — attempt {latest.attempt + 1}
      </div>
      <div className="flex flex-wrap gap-1.5">
        {checks.map((c, i) => (
          <span
            key={i}
            className={
              c.pass
                ? "inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] bg-emerald-50 text-emerald-700 border border-emerald-200"
                : "inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] bg-red-50 text-red-700 border border-red-200"
            }
            title={c.message ?? ""}
          >
            {c.pass ? (
              <CheckCircle2 className="h-2.5 w-2.5" />
            ) : (
              <AlertTriangle className="h-2.5 w-2.5" />
            )}
            {c.name}
          </span>
        ))}
      </div>
    </div>
  );
}

function parsePlan(events: RunDetail["events"]): Plan | null {
  for (let i = events.length - 1; i >= 0; i--) {
    if (events[i].kind === "plan.completed") {
      try {
        const p = JSON.parse(events[i].payload_json) as { plan?: Plan } & Plan;
        return p.plan ?? p;
      } catch {
        return null;
      }
    }
  }
  return null;
}

function collectTouchedFiles(events: RunDetail["events"]): string[] {
  const set = new Set<string>();
  for (const e of events) {
    if (e.kind !== "implement.tool_use") continue;
    try {
      const p = JSON.parse(e.payload_json) as {
        input?: { file_path?: string; path?: string };
      };
      const fp = p.input?.file_path ?? p.input?.path;
      if (fp) set.add(fp);
    } catch {
      /* ignore */
    }
  }
  return Array.from(set);
}

function summarizePayload(kind: string, json: string): string {
  try {
    const p = JSON.parse(json) as Record<string, unknown>;
    if (kind === "implement.tool_use") {
      const name = (p as { name?: string }).name ?? "tool";
      const input = (p as { input?: Record<string, unknown> }).input ?? {};
      const fp = (input.file_path ?? input.path) as string | undefined;
      return fp ? `${name} ${basename(fp)}` : name;
    }
    if (kind === "verification.check_completed") {
      const n = (p as { name?: string; pass?: boolean }).name ?? "?";
      const pass = (p as { pass?: boolean }).pass;
      return `${n} ${pass ? "✓" : "✗"}`;
    }
    if (kind === "pr.opened") {
      const num = (p as { number?: number }).number;
      return num ? `#${num}` : "";
    }
    if (kind === "claude.subprocess.spawned") {
      const mode = (p as { mode?: string }).mode;
      return mode ?? "";
    }
    return "";
  } catch {
    return "";
  }
}

function safeParseChecks(
  json: string,
): Array<{ name: string; pass: boolean; message?: string }> {
  try {
    const arr = JSON.parse(json);
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

function basename(p: string): string {
  return p.replace(/^.*\//, "");
}
