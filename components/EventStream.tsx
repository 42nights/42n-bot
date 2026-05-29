"use client";

import { useEffect, useRef, useState } from "react";
import { formatRelative } from "@/lib/utils";
import { cn } from "@/lib/utils";

export type EventRow = {
  id: number;
  ts: number;
  kind: string;
  payload_json: string;
};

const KIND_COLOR: Record<string, string> = {
  "run.created": "bg-zinc-100 text-zinc-700",
  "run.status": "bg-zinc-100 text-zinc-700",
  "plan.started": "bg-sky-50 text-sky-700",
  "plan.completed": "bg-sky-50 text-sky-700",
  "plan.aborted": "bg-amber-50 text-amber-700",
  "implement.started": "bg-violet-50 text-violet-700",
  "implement.tool_use": "bg-violet-50 text-violet-700",
  "implement.completed": "bg-violet-50 text-violet-700",
  "implement.failed": "bg-red-50 text-red-700",
  "verification.started": "bg-emerald-50 text-emerald-700",
  "verification.check_started": "bg-emerald-50 text-emerald-700",
  "verification.check_completed": "bg-emerald-50 text-emerald-700",
  "verification.completed": "bg-emerald-50 text-emerald-700",
  "iteration.started": "bg-amber-50 text-amber-700",
  "pr.opened": "bg-emerald-100 text-emerald-800",
  "pr.needs_review": "bg-amber-100 text-amber-800",
  "pr.failed": "bg-red-100 text-red-800",
  "run.finished": "bg-zinc-200 text-zinc-800",
  "claude.subprocess.spawned": "bg-zinc-50 text-zinc-600",
  "claude.subprocess.exit": "bg-zinc-50 text-zinc-600",
  "claude.budget_exceeded": "bg-red-50 text-red-700",
};

export function EventStream({
  runId,
  initialEvents,
  live = true,
}: {
  runId: number;
  initialEvents: EventRow[];
  live?: boolean;
}) {
  const [events, setEvents] = useState<EventRow[]>(initialEvents);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!live) return;
    const src = new EventSource(`/api/runs/${runId}/events`);
    src.onmessage = (ev) => {
      try {
        const e = JSON.parse(ev.data) as EventRow;
        setEvents((prev) =>
          prev.some((p) => p.id === e.id) ? prev : [...prev, e],
        );
      } catch {
        /* swallow */
      }
    };
    src.addEventListener("end", () => src.close());
    return () => src.close();
  }, [runId, live]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [events.length]);

  return (
    <div className="rounded-lg border border-border bg-background overflow-hidden">
      <div className="px-3 py-2 border-b border-border bg-muted/30 text-[11px] uppercase tracking-wider text-muted-foreground">
        Event log · {events.length}
      </div>
      <div className="max-h-[40vh] overflow-y-auto">
        {events.length === 0 ? (
          <div className="px-3 py-6 text-sm text-muted-foreground text-center">
            (no events yet)
          </div>
        ) : (
          <ul className="divide-y divide-border">
            {events.map((e) => {
              let payload: any = {};
              try {
                payload = JSON.parse(e.payload_json);
              } catch {/* ignore */}
              return (
                <li key={e.id} className="px-3 py-2 flex items-start gap-3 text-xs">
                  <span
                    className={cn(
                      "shrink-0 inline-block w-44 px-2 py-0.5 rounded text-[10px] font-mono uppercase",
                      KIND_COLOR[e.kind] ?? "bg-zinc-50 text-zinc-600",
                    )}
                  >
                    {e.kind}
                  </span>
                  <span className="flex-1 min-w-0 break-words font-mono text-[11px] text-zinc-700">
                    {Object.keys(payload).length
                      ? JSON.stringify(payload)
                      : ""}
                  </span>
                  <span className="shrink-0 text-[10px] text-muted-foreground tabular-nums">
                    {new Date(e.ts).toLocaleTimeString()}
                  </span>
                </li>
              );
            })}
            <div ref={bottomRef} />
          </ul>
        )}
      </div>
    </div>
  );
}
