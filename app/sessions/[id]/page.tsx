"use client";

import { use } from "react";
import Link from "next/link";
import useSWR from "swr";
import { toast } from "sonner";
import { motion, AnimatePresence } from "framer-motion";
import { fetcher } from "@/lib/api-client";
import { NarrationStream } from "@/components/NarrationStream";
import { SessionWorkspace } from "@/components/SessionWorkspace";
import { CelebrationListener } from "@/components/CelebrationListener";
import { Scrubber } from "@/components/Scrubber";
import { Skeleton } from "@/components/ui/Skeleton";
import { useReplay } from "@/lib/replay";
import { ArrowLeft, ExternalLink, GitPullRequest, Share2 } from "lucide-react";
import { LiveDot } from "@/components/icons/LiveDot";
import { PhaseCostBar } from "@/components/PhaseCostBar";
import { cn } from "@/lib/utils";
import type { EventRow } from "@/lib/narration";

const spring = { type: "spring" as const, stiffness: 320, damping: 36, mass: 0.8 };

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

const ACTIVE = new Set([
  "queued",
  "planning",
  "implementing",
  "verifying",
  "iterating",
]);

const TERMINAL = new Set([
  "pr-opened",
  "succeeded",
  "needs-review",
  "failed",
  "abandoned",
]);

const PHASES = [
  { key: "planning", label: "Planning" },
  { key: "implementing", label: "Implementing" },
  { key: "verifying", label: "Verifying" },
  { key: "pr", label: "PR" },
];

export default function SessionPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const { data, error } = useSWR<{
    run: Run;
    events: EventRow[];
    verdicts: Verdict[];
  }>(`/api/runs/${id}`, fetcher, { refreshInterval: 3000 });

  if (error) {
    return (
      <div className="flex flex-col h-[calc(100vh-6.25rem)]">
        <div className="h-12 px-6 flex items-center gap-4 border-b border-border">
          <Link
            href="/sessions"
            className="inline-flex items-center gap-1.5 text-xs text-[var(--fg-muted)] hover:text-[var(--fg)] transition-colors"
          >
            <ArrowLeft className="h-3.5 w-3.5" /> Sessions
          </Link>
        </div>
        <div className="flex-1 flex items-center justify-center">
          <p className="text-sm text-[var(--fg-muted)]">
            {error.status === 404
              ? "Session not found."
              : "Failed to load session. Try refreshing."}
          </p>
        </div>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="flex flex-col h-[calc(100vh-6.25rem)]">
        <div className="h-12 px-6 flex items-center gap-4 border-b border-border">
          <Skeleton className="h-4 w-24" />
          <Skeleton className="h-4 w-64" />
        </div>
        <div className="h-1 bg-[var(--bg-sunken)]" />
        <div className="flex-1 grid grid-cols-1 md:grid-cols-[38%_62%]">
          <div className="border-r border-border p-6 space-y-4">
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} className={`h-10 ${i % 3 === 0 ? "w-3/4" : "w-full"}`} />
            ))}
          </div>
          <div className="p-6 space-y-4">
            <Skeleton className="h-8 w-48" />
            <Skeleton className="h-32 w-full" />
          </div>
        </div>
      </div>
    );
  }
  const { run, events, verdicts } = data;
  const isLive = ACTIVE.has(run.status);
  const subject =
    run.issue_title ??
    (run.type === "review" ? "Scanning the repo" : `Session #${run.id}`);

  return (
    <ReplayWrapper
      run={run}
      allEvents={events}
      verdicts={verdicts}
      isLive={isLive}
      isTerminal={TERMINAL.has(run.status)}
      subject={subject}
      runId={id}
    />
  );
}

// Separated so useReplay is always called (no conditional hook), with empty
// events when live — the hook becomes a no-op in that case.
function ReplayWrapper({
  run,
  allEvents,
  verdicts,
  isLive,
  isTerminal,
  subject,
  runId,
}: {
  run: Run;
  allEvents: EventRow[];
  verdicts: Verdict[];
  isLive: boolean;
  isTerminal: boolean;
  subject: string;
  runId: string;
}) {
  const replay = useReplay(isTerminal ? allEvents : []);

  // When replay is at t=0 and not playing, show the full set so the page isn't
  // blank on first load. Once the user hits play, filter by playhead.
  const displayEvents =
    isTerminal && (replay.playing || replay.playhead > 0)
      ? replay.visibleEvents
      : allEvents;

  return (
    <div className="flex flex-col h-[calc(100vh-6.25rem)]">
      <CelebrationListener events={allEvents} />
      <SessionHeader
        run={run}
        subject={subject}
        isLive={isLive}
        runId={runId}
      />
      <PhaseCostBar runId={run.id} />
      <PhaseStrip status={run.status} hasPr={!!run.pr_url} />
      <div className="flex-1 min-h-0 grid grid-cols-1 md:grid-cols-[38%_62%]">
        <aside className="border-r border-border min-h-0">
          <NarrationStream
            runId={run.id}
            initialEvents={displayEvents}
            live={isLive}
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
            isLive={isLive}
          />
        </section>
      </div>
      {isTerminal && (
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
      )}
    </div>
  );
}

function SessionHeader({
  run,
  subject,
  isLive,
  runId,
}: {
  run: Run;
  subject: string;
  isLive: boolean;
  runId: string;
}) {
  const handleShare = () => {
    const url = `${window.location.origin}/sessions/${runId}/share`;
    navigator.clipboard.writeText(url).then(() => {
      toast("Link copied");
    });
  };

  return (
    <header className="h-12 px-6 flex items-center justify-between border-b border-border bg-[var(--bg)]">
      <div className="flex items-center gap-4 min-w-0">
        <Link
          href="/sessions"
          className="inline-flex items-center gap-1.5 text-xs text-[var(--fg-muted)] hover:text-[var(--fg)] transition-colors"
        >
          <ArrowLeft className="h-3.5 w-3.5" /> Sessions
        </Link>
        <div className="flex items-center gap-2 min-w-0">
          {isLive && <LiveDot active />}
          <AnimatePresence mode="wait">
            <motion.span
              key={isLive ? "live" : "done"}
              className="text-sm text-[var(--fg-muted)]"
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -4 }}
              transition={{ duration: 0.18 }}
            >
              {isLive ? "Otis is working on" : "Otis worked on"}
            </motion.span>
          </AnimatePresence>
          <span className="text-sm font-medium text-[var(--fg)] truncate">
            &ldquo;{subject}&rdquo;
          </span>
        </div>
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
        <button
          onClick={handleShare}
          className="inline-flex items-center gap-1.5 text-xs text-[var(--fg-muted)] hover:text-[var(--fg)] transition-colors"
          aria-label="Copy share link"
        >
          <Share2 className="h-3.5 w-3.5" /> Share
        </button>
        <div className="text-xs text-[var(--fg-muted)] font-mono tabular-nums">
          ${run.cost_usd.toFixed(2)}
        </div>
      </div>
    </header>
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
    <div className="h-1 bg-[var(--bg-sunken)] flex overflow-hidden">
      {PHASES.map((p, i) => (
        <motion.div
          key={p.key}
          className={cn(
            "flex-1",
            i < idx
              ? "bg-[var(--accent)]"
              : i === idx
                ? "bg-[var(--accent)] opacity-50"
                : "bg-transparent",
          )}
          layout
          transition={spring}
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
