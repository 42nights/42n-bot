"use client";

import { use } from "react";
import Link from "next/link";
import useSWR from "swr";
import { fetcher } from "@/lib/api-client";
import { NarrationStream } from "@/components/NarrationStream";
import { SessionWorkspace } from "@/components/SessionWorkspace";
import { Scrubber } from "@/components/Scrubber";
import { useReplay } from "@/lib/replay";
import { ExternalLink, GitPullRequest } from "lucide-react";
import { cn } from "@/lib/utils";
import type { EventRow } from "@/lib/narration";

type Run = {
  id: string;
  type: "implement" | "review" | "system";
  repo: string;
  issue_number: number | null;
  issue_title: string | null;
  issue_body: string | null;
  branch_name: string | null;
  pr_number: number | null;
  pr_url: string | null;
  status: string;
  attempts: number;
  cost_usd: number;
  started_at: number;
  finished_at: number | null;
  error_message: string | null;
};

type Verdict = {
  id: string;
  attempt: number;
  pass: number;
  failure_summary: string | null;
  checks_json: string;
};

const PHASES = [
  { key: "planning", label: "Planning" },
  { key: "implementing", label: "Implementing" },
  { key: "verifying", label: "Verifying" },
  { key: "pr", label: "PR" },
];

export default function SharePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const { data, error } = useSWR<{
    run: Run;
    events: EventRow[];
    verdicts: Verdict[];
  }>(`/api/runs/${id}`, fetcher);

  if (error) {
    return (
      <div className="p-10 text-sm text-[var(--fg-muted)]">
        Session not found.
      </div>
    );
  }

  if (!data) {
    return (
      <div className="p-10 text-sm text-[var(--fg-muted)]">Loading…</div>
    );
  }

  const { run, events, verdicts } = data;
  const subject =
    run.issue_title ??
    (run.type === "review" ? "Scanning the repo" : `Session #${run.id}`);

  return (
    <ShareReplayWrapper
      run={run}
      allEvents={events}
      verdicts={verdicts}
      subject={subject}
    />
  );
}

function ShareReplayWrapper({
  run,
  allEvents,
  verdicts,
  subject,
}: {
  run: Run;
  allEvents: EventRow[];
  verdicts: Verdict[];
  subject: string;
}) {
  const replay = useReplay(allEvents);

  const displayEvents =
    replay.playing || replay.playhead > 0
      ? replay.visibleEvents
      : allEvents;

  return (
    <div className="flex flex-col h-[calc(100vh-6.25rem)]">
      {/* Read-only banner */}
      <div className="h-8 px-6 flex items-center gap-2 bg-[var(--bg-sunken)] border-b border-border">
        <span className="text-[11px] uppercase tracking-[0.14em] text-[var(--fg-muted)]">
          Shared session
        </span>
        <span className="text-[var(--border)]">·</span>
        <span className="text-[11px] text-[var(--fg-subtle)]">read-only</span>
      </div>

      {/* Share header — no admin actions */}
      <header className="h-12 px-6 flex items-center justify-between border-b border-border bg-[var(--bg)]">
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-sm text-[var(--fg-muted)]">Otis worked on</span>
          <span className="text-sm font-medium text-[var(--fg)] truncate">
            "{subject}"
          </span>
        </div>
        <div className="flex items-center gap-3 shrink-0">
          {run.pr_url && (
            <a
              href={run.pr_url}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1.5 text-xs text-[var(--accent)] hover:underline"
            >
              <GitPullRequest className="h-3.5 w-3.5" /> PR #{run.pr_number}
              <ExternalLink className="h-3 w-3" />
            </a>
          )}
          <div className="text-xs text-[var(--fg-muted)] font-mono tabular-nums">
            ${run.cost_usd.toFixed(2)}
          </div>
        </div>
      </header>

      <PhaseStrip status={run.status} hasPr={!!run.pr_url} />

      <div className="flex-1 min-h-0 grid grid-cols-1 md:grid-cols-[38%_62%]">
        <aside className="border-r border-border min-h-0">
          <NarrationStream
            runId={run.id}
            initialEvents={displayEvents}
            live={false}
            ctx={{
              issueNumber: run.issue_number,
              issueTitle: run.issue_title,
              repo: run.repo,
              runType: run.type,
            }}
          />
        </aside>
        <section className="min-h-0 overflow-y-auto">
          <SessionWorkspace
            run={run}
            events={displayEvents}
            verdicts={verdicts}
            isLive={false}
          />
        </section>
      </div>

      <Scrubber
        playhead={replay.playhead}
        duration={replay.duration}
        playing={replay.playing}
        speed={replay.speed}
        events={allEvents}
        onPlay={replay.play}
        onPause={replay.pause}
        onSeek={replay.setPlayhead}
        onSpeed={replay.setSpeed}
      />
    </div>
  );
}

function PhaseStrip({
  status,
  hasPr,
}: {
  status: string;
  hasPr: boolean;
}) {
  const idx = phaseIndex(status, hasPr);
  return (
    <div className="h-1 bg-[var(--bg-sunken)] flex">
      {PHASES.map((p, i) => (
        <div
          key={p.key}
          className={cn(
            "flex-1 transition-colors",
            i < idx
              ? "bg-[var(--accent)]"
              : i === idx
                ? "bg-[var(--accent)] opacity-50"
                : "bg-transparent",
          )}
        />
      ))}
    </div>
  );
}

function phaseIndex(status: string, hasPr: boolean): number {
  if (status === "queued") return 0;
  if (status === "planning") return 0;
  if (status === "implementing" || status === "iterating") return 1;
  if (status === "verifying") return 2;
  if (status === "pr-opened" || status === "succeeded") return 4;
  if (status === "needs-review") return 3;
  if (hasPr) return 3;
  return 0;
}
