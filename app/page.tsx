"use client";

import { Suspense, useRef, useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import useSWR from "swr";
import { toast } from "sonner";
import Link from "next/link";
import { motion, AnimatePresence } from "framer-motion";
import { fetcher } from "@/lib/api-client";
import { translate, type EventRow, type TranslateContext } from "@/lib/narration";
import { formatUsd } from "@/lib/utils";
import { useRepoScope } from "@/lib/repo-scope";
import { tenant } from "@/lib/tenant";
import { LiveDot } from "@/components/icons/LiveDot";
import { Skeleton } from "@/components/ui/Skeleton";
import { ArrowRight, Send } from "lucide-react";
import type { RunSummary } from "@/components/RunCard";

const spring = { type: "spring" as const, stiffness: 320, damping: 36, mass: 0.8 };

type RollupRow = {
  total: number;
  shipped: number;
  needs_review: number;
  abandoned: number;
  failed: number;
  cost_usd: number;
};

type RunsResponse = { runs: RunSummary[]; today: RollupRow };

const ACTIVE_STATUSES = new Set([
  "queued",
  "planning",
  "implementing",
  "verifying",
  "iterating",
]);

// 7-day sparkline with animated bars
function Sparkline({ runs }: { runs: RunSummary[] }) {
  const now = Date.now();
  const days = Array.from({ length: 7 }, (_, i) => {
    const dayStart = now - (6 - i) * 86_400_000;
    const dayEnd = dayStart + 86_400_000;
    const count = runs.filter(
      (r) =>
        (r.status === "pr-opened" || r.status === "succeeded") &&
        r.started_at >= dayStart &&
        r.started_at < dayEnd,
    ).length;
    return count;
  });

  const max = Math.max(...days, 1);
  const W = 7 * 10 + 6 * 4;
  const H = 28;

  return (
    <svg
      width={W}
      height={H}
      viewBox={`0 0 ${W} ${H}`}
      aria-hidden="true"
      className="shrink-0"
    >
      {days.map((v, i) => {
        const barH = Math.max(2, Math.round((v / max) * H));
        const x = i * 14;
        return (
          <motion.rect
            key={i}
            x={x}
            width={10}
            rx={2}
            fill={v > 0 ? "var(--accent)" : "var(--border)"}
            opacity={v > 0 ? 0.8 : 1}
            initial={{ y: H, height: 0 }}
            animate={{ y: H - barH, height: barH }}
            transition={{ ...spring, delay: i * 0.04 }}
          />
        );
      })}
    </svg>
  );
}

function useLatestNarration(runId: string | null, run: RunSummary | null) {
  const { data } = useSWR<{
    run: RunSummary;
    events: EventRow[];
  }>(runId ? `/api/runs/${runId}` : null, fetcher, {
    refreshInterval: 2000,
  });

  if (!data || !run) return null;
  const events = data.events;
  for (let i = events.length - 1; i >= 0; i--) {
    const ctx: TranslateContext = {
      issueNumber: run.issue_number,
      issueTitle: run.issue_title,
      repo: run.repo,
      runType: run.type,
    };
    const line = translate(events[i], ctx);
    if (line) return line.text;
  }
  return null;
}

export default function HomePage() {
  return (
    <Suspense
      fallback={
        <div className="max-w-2xl mx-auto px-6 pt-[10vh] pb-24 space-y-8">
          <div className="text-center space-y-3">
            <Skeleton className="h-24 w-32 mx-auto" />
            <Skeleton className="h-5 w-48 mx-auto" />
            <Skeleton className="h-5 w-56 mx-auto" />
          </div>
          <Skeleton className="h-28 w-full" />
          <Skeleton className="h-20 w-full" />
          <Skeleton className="h-16 w-full" />
        </div>
      }
    >
      <Home />
    </Suspense>
  );
}

function Home() {
  const router = useRouter();
  const { scope, queryParam } = useRepoScope();
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [prompt, setPrompt] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const { data } = useSWR<RunsResponse>(
    `/api/runs?limit=80${queryParam}`,
    fetcher,
    { refreshInterval: 3000 },
  );

  const runs = data?.runs ?? [];

  const activeRun = runs.find((r) => ACTIVE_STATUSES.has(r.status)) ?? null;
  const narration = useLatestNarration(activeRun?.id ?? null, activeRun);

  const handleInput = useCallback(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, []);

  useEffect(() => {
    handleInput();
  }, [prompt, handleInput]);

  async function submit() {
    const trimmed = prompt.trim();
    if (!trimmed || submitting) return;
    setSubmitting(true);
    try {
      const res = await fetch("/api/sessions/start", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          prompt: trimmed,
          repo: scope === "all" ? undefined : scope,
        }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? `${res.status}`);
      toast.success(`Issue created — Otis is on it`);
      setPrompt("");
      router.push("/sessions");
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setSubmitting(false);
    }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
      e.preventDefault();
      submit();
    }
  }

  const weekStart = Date.now() - 7 * 86_400_000;
  const weekRuns = runs.filter((r) => r.started_at >= weekStart);
  const weekSessions = weekRuns.length;
  const weekPRs = weekRuns.filter(
    (r) => r.status === "pr-opened" || r.status === "succeeded",
  ).length;
  const weekReview = weekRuns.filter((r) => r.status === "needs-review").length;
  const weekCost = weekRuns.reduce((s, r) => s + r.cost_usd, 0);

  return (
    <div className="max-w-2xl mx-auto px-6 pt-[10vh] pb-24">
      {/* Hero with staggered fade-in */}
      <motion.div
        className="text-center mb-12"
        initial="hidden"
        animate="visible"
        variants={{
          hidden: {},
          visible: { transition: { staggerChildren: 0.08 } },
        }}
      >
        <motion.h1
          className="font-serif text-[var(--fg)]"
          style={{ fontSize: "clamp(60px,8vw,96px)", lineHeight: 1.05 }}
          variants={{
            hidden: { opacity: 0, y: 16 },
            visible: { opacity: 1, y: 0, transition: spring },
          }}
        >
          Otis
        </motion.h1>
        <div className="mt-4 space-y-1">
          {[
            "AI engineer at 42nights",
            "Reads issues. Writes PRs.",
            "Asks before doing anything risky.",
          ].map((line) => (
            <motion.p
              key={line}
              className="text-lg text-[var(--fg-muted)]"
              variants={{
                hidden: { opacity: 0, y: 10 },
                visible: { opacity: 1, y: 0, transition: spring },
              }}
            >
              {line}
            </motion.p>
          ))}
        </div>
      </motion.div>

      {/* Prompt input */}
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ ...spring, delay: 0.32 }}
        className="prompt-textarea-wrap rounded-xl border border-[var(--border)] bg-[var(--bg-elev)] overflow-hidden mb-8"
      >
        <div className="px-4 pt-4 pb-2">
          <textarea
            ref={textareaRef}
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            onKeyDown={handleKeyDown}
            onInput={handleInput}
            placeholder={'Send Otis to work…\ne.g. "fix the rate limiter in src/webhook.ts"'}
            rows={2}
            className="w-full resize-none bg-transparent text-[var(--fg)] placeholder:text-[var(--fg-subtle)] text-sm leading-relaxed focus:outline-none"
            aria-label="Task for Otis"
          />
        </div>
        <div className="px-3 pb-3 flex items-center justify-between">
          <span className="text-[11px] text-[var(--fg-subtle)] font-mono">
            {prompt.trim() ? "Cmd+Enter to send" : ""}
          </span>
          <button
            onClick={submit}
            disabled={!prompt.trim() || submitting}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-[var(--accent)] text-[var(--accent-fg)] text-sm font-medium disabled:opacity-40 hover:opacity-90 transition-opacity"
          >
            {submitting ? (
              "Sending…"
            ) : (
              <>
                <Send className="h-3.5 w-3.5" />
                Send to Otis
                <kbd className="font-mono text-[10px] opacity-60">&#8629;</kbd>
              </>
            )}
          </button>
        </div>
      </motion.div>

      {/* Right Now card */}
      <motion.section
        className="mb-8"
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ ...spring, delay: 0.44 }}
      >
        <h2 className="text-[11px] uppercase tracking-[0.18em] text-[var(--fg-muted)] mb-3">
          Right now
        </h2>
        <AnimatePresence mode="wait">
          {activeRun ? (
            <motion.div
              key="active"
              layout
              initial={{ opacity: 0, scale: 0.98 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.98 }}
              transition={spring}
            >
              <Link
                href={`/sessions/${activeRun.id}`}
                className="block rounded-xl border border-[var(--accent-soft)] bg-[var(--bg-elev)] p-4 hover:bg-[var(--bg-sunken)] transition-colors"
              >
                <div className="flex items-start gap-3">
                  <LiveDot active className="mt-0.5 shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-[var(--fg)] truncate">
                      Otis is working on{" "}
                      {activeRun.issue_number ? (
                        <span className="font-mono">#{activeRun.issue_number}</span>
                      ) : null}
                      {activeRun.issue_title ? ` — ${activeRun.issue_title}` : ""}
                    </p>
                    <div className="mt-1 flex items-center gap-3 text-[11px] text-[var(--fg-muted)]">
                      <span>
                        {Math.round((Date.now() - activeRun.started_at) / 60_000)}m in
                      </span>
                      <span>·</span>
                      <span>spent {formatUsd(activeRun.cost_usd)}</span>
                      {activeRun.repo && (
                        <>
                          <span>·</span>
                          <span className="font-mono truncate">{activeRun.repo}</span>
                        </>
                      )}
                    </div>
                    <AnimatePresence mode="wait">
                      {narration && (
                        <motion.p
                          key={narration}
                          className="mt-2 text-xs text-[var(--fg-muted)] italic truncate"
                          initial={{ opacity: 0, height: 0 }}
                          animate={{ opacity: 1, height: "auto" }}
                          exit={{ opacity: 0, height: 0 }}
                          transition={{ duration: 0.2 }}
                          layout
                        >
                          {narration}
                        </motion.p>
                      )}
                    </AnimatePresence>
                  </div>
                  <div className="shrink-0 flex items-center gap-1 text-xs text-[var(--accent)]">
                    Watch live
                    <ArrowRight className="h-3.5 w-3.5" />
                  </div>
                </div>
              </Link>
            </motion.div>
          ) : (
            <motion.div
              key="idle"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.2 }}
              className="rounded-xl border border-dashed border-[var(--border)] bg-[var(--bg-elev)] p-4 text-sm text-[var(--fg-muted)]"
            >
              Otis is idle. Send a task above.
            </motion.div>
          )}
        </AnimatePresence>
      </motion.section>

      {/* This Week strip */}
      <motion.section
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ ...spring, delay: 0.52 }}
      >
        <h2 className="text-[11px] uppercase tracking-[0.18em] text-[var(--fg-muted)] mb-3">
          This week
        </h2>
        <div className="rounded-xl border border-[var(--border)] bg-[var(--bg-elev)] px-4 py-3 flex items-center justify-between gap-4 flex-wrap">
          <div className="flex items-center gap-6 text-sm flex-wrap">
            <span className="text-[var(--fg)]">
              <span className="tabular-nums font-semibold">{weekSessions}</span>
              <span className="text-[var(--fg-muted)] ml-1">sessions</span>
            </span>
            <span className="text-[var(--fg)]">
              <span className="tabular-nums font-semibold">{weekPRs}</span>
              <span className="text-[var(--fg-muted)] ml-1">PRs landed</span>
            </span>
            {weekReview > 0 && (
              <span className="text-[var(--fg)]">
                <span className="tabular-nums font-semibold">{weekReview}</span>
                <span className="text-[var(--fg-muted)] ml-1">needed review</span>
              </span>
            )}
            <span className="text-[var(--fg-muted)] tabular-nums">
              {formatUsd(weekCost)}
            </span>
          </div>
          <Sparkline runs={runs} />
        </div>
      </motion.section>

      <p className="mt-8 text-center text-[11px] text-[var(--fg-subtle)]">
        Built on{" "}
        <a
          href={tenant.publicUrl ?? "https://42nights.dev"}
          target="_blank"
          rel="noopener noreferrer"
          className="underline underline-offset-2 hover:text-[var(--fg-muted)] transition-colors"
        >
          42nights
        </a>
      </p>
    </div>
  );
}
