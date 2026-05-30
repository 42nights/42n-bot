"use client";

import { useMemo } from "react";
import { Circle, FileCode, CheckCircle2, AlertTriangle } from "lucide-react";
import { cn } from "@/lib/utils";

type PlanFile = {
  path: string;
  kind: string;
  why: string;
};

type PlanTest = {
  path: string;
  describes: string;
};

type Plan = {
  files_to_change?: PlanFile[];
  tests_to_add_or_update?: PlanTest[];
  user_visible_change?: string;
  complexity?: string;
  should_abort?: boolean;
};

type Event = {
  id: number;
  ts: number;
  kind: string;
  payload_json: string;
};

type FileStatus = "queued" | "editing" | "done";

function getFileStatus(
  path: string,
  touchedFiles: string[],
  latestTouched: string | null,
): FileStatus {
  if (latestTouched === path) return "editing";
  if (touchedFiles.includes(path)) return "done";
  return "queued";
}

function StatusPill({ status }: { status: FileStatus }) {
  if (status === "editing") {
    return (
      <span
        className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-mono bg-[var(--plan-soft)] text-[var(--plan)] border border-[var(--plan-soft)] animate-pulse"
        title="Editing now"
      >
        <span className="w-1.5 h-1.5 rounded-full bg-[var(--plan)] inline-block" />
        editing
      </span>
    );
  }
  if (status === "done") {
    return (
      <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-mono bg-[var(--accent-soft)] text-[var(--accent)] border border-[var(--accent-soft)]">
        <CheckCircle2 className="w-2.5 h-2.5" />
        done
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-mono bg-[var(--bg-sunken)] text-[var(--fg-subtle)] border border-[var(--border)]">
      <Circle className="w-2.5 h-2.5" />
      queued
    </span>
  );
}

function kindGlyph(kind: string) {
  if (kind === "create") return <span className="text-[var(--accent)] font-mono text-xs">+</span>;
  if (kind === "delete") return <span className="text-[var(--fail)] font-mono text-xs">−</span>;
  return <span className="text-[var(--plan)] font-mono text-xs">~</span>;
}

export function PlanTab({ events }: { events: Event[] }) {
  const { plan, touchedFiles, latestTouched } = useMemo(() => {
    let plan: Plan | null = null;
    const touchedSet = new Set<string>();
    let latestTouched: string | null = null;

    for (const e of events) {
      if (e.kind === "plan.completed") {
        try {
          const p = JSON.parse(e.payload_json);
          plan = p.plan ?? p;
        } catch {
          /* ignore */
        }
      }
      if (e.kind === "implement.tool_use") {
        try {
          const p = JSON.parse(e.payload_json);
          const fp = p.input?.file_path ?? p.input?.path;
          if (fp) {
            touchedSet.add(fp);
            latestTouched = fp;
          }
        } catch {
          /* ignore */
        }
      }
    }

    return { plan, touchedFiles: Array.from(touchedSet), latestTouched };
  }, [events]);

  if (!plan && touchedFiles.length === 0) {
    return (
      <div className="flex items-center justify-center h-full min-h-[200px]">
        <p className="text-sm text-[var(--fg-muted)] italic">Otis is still planning…</p>
      </div>
    );
  }

  return (
    <div className="space-y-8 max-w-2xl py-2">
      {/* File tree */}
      {plan?.files_to_change && plan.files_to_change.length > 0 && (
        <div>
          <p className="text-[11px] uppercase tracking-[0.18em] text-[var(--fg-muted)] mb-3">
            Files to change
          </p>
          <div className="space-y-1">
            {plan.files_to_change.map((f, i) => {
              const status = getFileStatus(f.path, touchedFiles, latestTouched);
              return (
                <div
                  key={i}
                  className={cn(
                    "flex items-center gap-3 px-3 py-2 rounded-md border",
                    status === "editing"
                      ? "border-[var(--plan)] bg-[var(--plan-soft)]"
                      : status === "done"
                        ? "border-[var(--border)] bg-[var(--bg-elev)] opacity-70"
                        : "border-[var(--border)] bg-[var(--bg-elev)]",
                  )}
                >
                  <FileCode className="w-3.5 h-3.5 shrink-0 text-[var(--fg-subtle)]" />
                  <span className="flex-1 font-mono text-[12px] text-[var(--fg)] truncate">
                    {kindGlyph(f.kind)}{" "}
                    <span className="ml-0.5">{f.path}</span>
                  </span>
                  {f.why && (
                    <span className="hidden sm:inline text-[11px] text-[var(--fg-muted)] truncate max-w-[180px]">
                      {f.why}
                    </span>
                  )}
                  <StatusPill status={status} />
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Tests */}
      {plan?.tests_to_add_or_update && plan.tests_to_add_or_update.length > 0 && (
        <div>
          <p className="text-[11px] uppercase tracking-[0.18em] text-[var(--fg-muted)] mb-3">
            Tests
          </p>
          <div className="space-y-1">
            {plan.tests_to_add_or_update.map((t, i) => {
              const status = getFileStatus(t.path, touchedFiles, latestTouched);
              return (
                <div
                  key={i}
                  className={cn(
                    "flex items-center gap-3 px-3 py-2 rounded-md border",
                    status === "editing"
                      ? "border-[var(--plan)] bg-[var(--plan-soft)]"
                      : "border-[var(--border)] bg-[var(--bg-elev)]",
                  )}
                >
                  <FileCode className="w-3.5 h-3.5 shrink-0 text-[var(--fg-subtle)]" />
                  <span className="flex-1 font-mono text-[12px] text-[var(--fg)] truncate">
                    {t.path}
                  </span>
                  {t.describes && (
                    <span className="hidden sm:inline text-[11px] text-[var(--fg-muted)] truncate max-w-[180px]">
                      {t.describes}
                    </span>
                  )}
                  <StatusPill status={status} />
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Notes panel */}
      {(plan?.user_visible_change || plan?.complexity || plan?.should_abort) && (
        <div className="rounded-md border border-[var(--border)] bg-[var(--bg-elev)] p-4 space-y-3">
          <p className="text-[11px] uppercase tracking-[0.18em] text-[var(--fg-muted)]">Notes</p>
          {plan.user_visible_change && (
            <p className="text-sm text-[var(--fg)] leading-relaxed">{plan.user_visible_change}</p>
          )}
          <div className="flex items-center gap-4 flex-wrap">
            {plan.complexity && (
              <span className="text-[11px] font-mono text-[var(--fg-muted)]">
                complexity:{" "}
                <span className="text-[var(--plan)]">{plan.complexity}</span>
              </span>
            )}
            {plan.should_abort && (
              <span className="inline-flex items-center gap-1 text-[11px] text-[var(--warn)]">
                <AlertTriangle className="w-3 h-3" />
                abort recommended
              </span>
            )}
          </div>
        </div>
      )}

      {/* Fallback: files touched but no plan yet */}
      {!plan && touchedFiles.length > 0 && (
        <div>
          <p className="text-[11px] uppercase tracking-[0.18em] text-[var(--fg-muted)] mb-3">
            Files touched ({touchedFiles.length})
          </p>
          <div className="space-y-1">
            {touchedFiles.map((p) => (
              <div
                key={p}
                className="px-3 py-1.5 rounded-md border border-[var(--border)] bg-[var(--bg-elev)] font-mono text-[12px] text-[var(--fg-muted)]"
              >
                {p}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
