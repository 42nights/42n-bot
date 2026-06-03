"use client";

import { useState } from "react";
import { GitPullRequest, ExternalLink, CheckCircle2, XCircle, AlertTriangle, GitBranch } from "lucide-react";
import { DiffTab } from "./DiffTab";
import { cn } from "@/lib/utils";

type Run = {
  id: string;
  type: "implement" | "review" | "system";
  pr_url: string | null;
  pr_number: number | null;
  status: string;
  attempts: number;
  issue_title: string | null;
  issue_body: string | null;
  branch_name: string | null;
};

type Verdict = {
  id: string;
  attempt: number;
  pass: number;
  failure_summary: string | null;
  checks_json: string;
};

type Event = {
  kind: string;
  payload_json: string;
};

type Check = {
  name: string;
  pass: boolean;
  message?: string;
};

function CheckStrip({ verdicts }: { verdicts: Verdict[] }) {
  if (verdicts.length === 0) return null;
  const latest = verdicts[verdicts.length - 1];
  let checks: Check[] = [];
  try {
    checks = JSON.parse(latest.checks_json);
  } catch {
    /* ignore */
  }
  if (checks.length === 0) return null;

  return (
    <div>
      <p className="text-[11px] uppercase tracking-[0.18em] text-[var(--fg-muted)] mb-2">
        Verification — attempt {latest.attempt + 1}
      </p>
      <div className="flex flex-wrap gap-1.5">
        {checks.map((c, i) => (
          <span
            key={i}
            title={c.message ?? ""}
            className={cn(
              "inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] border font-mono",
              c.pass
                ? "bg-[var(--accent-soft)] text-[var(--accent)] border-[var(--accent-soft)]"
                : "bg-[var(--fail-soft)] text-[var(--fail)] border-[var(--fail-soft)]",
            )}
          >
            {c.pass ? (
              <CheckCircle2 className="w-2.5 h-2.5" />
            ) : (
              <XCircle className="w-2.5 h-2.5" />
            )}
            {c.name}
          </span>
        ))}
      </div>
    </div>
  );
}

function CopyButton({ text, label }: { text: string; label: string }) {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };
  return (
    <button
      onClick={copy}
      className="inline-flex items-center gap-1.5 px-4 h-9 rounded-md border border-[var(--border)] bg-[var(--bg-elev)] text-sm text-[var(--fg-muted)] hover:text-[var(--fg)] hover:border-[var(--border-strong)] transition-colors"
    >
      {copied ? "Copied!" : label}
    </button>
  );
}

function PrOpen({
  run,
  verdicts,
  events,
}: {
  run: Run;
  verdicts: Verdict[];
  events: Event[];
}) {
  const title = run.issue_title ?? `Run #${run.id}`;
  const shareUrl =
    typeof window !== "undefined"
      ? `${window.location.origin}/sessions/${run.id}/share`
      : `/sessions/${run.id}/share`;

  return (
    <div className="flex flex-col gap-8 py-4 max-w-2xl">
      {/* Header */}
      <div className="flex items-start gap-3">
        <GitPullRequest className="w-5 h-5 text-[var(--accent)] mt-0.5 shrink-0" />
        <div className="flex-1 min-w-0">
          <p className="text-[11px] uppercase tracking-[0.18em] text-[var(--fg-muted)] mb-1">
            Pull Request
          </p>
          <h2 className="text-base font-medium text-[var(--fg)] leading-snug">
            {title}
          </h2>
          {run.branch_name && (
            <div className="flex items-center gap-1.5 mt-1">
              <GitBranch className="w-3 h-3 text-[var(--fg-subtle)]" />
              <span className="font-mono text-[11px] text-[var(--fg-subtle)]">
                {run.branch_name}
              </span>
            </div>
          )}
        </div>
        {run.pr_number && (
          <span className="text-[11px] font-mono text-[var(--fg-subtle)] shrink-0">
            #{run.pr_number}
          </span>
        )}
      </div>

      {/* Issue body as context */}
      {run.issue_body && (
        <div className="rounded-md border border-[var(--border)] bg-[var(--bg-elev)] p-4">
          <p className="text-[11px] uppercase tracking-[0.18em] text-[var(--fg-muted)] mb-2">
            Issue
          </p>
          <p className="text-sm text-[var(--fg)] leading-relaxed whitespace-pre-wrap line-clamp-6">
            {run.issue_body}
          </p>
        </div>
      )}

      {/* CTAs */}
      <div className="flex flex-wrap gap-3">
        <a
          href={run.pr_url!}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-2 px-5 h-10 rounded-md bg-[var(--accent)] text-[var(--accent-fg)] text-sm font-medium hover:opacity-90 transition-opacity"
        >
          Open on GitHub
          <ExternalLink className="w-3.5 h-3.5" />
        </a>
        <CopyButton text={shareUrl} label="Share this session →" />
      </div>

      {/* Verdicts */}
      <CheckStrip verdicts={verdicts} />

      {/* Diff preview (reuses DiffTab internals) — use a container */}
      <div>
        <p className="text-[11px] uppercase tracking-[0.18em] text-[var(--fg-muted)] mb-3">
          Changes
        </p>
        <div className="border border-[var(--border)] rounded-md overflow-hidden h-[320px]">
          <DiffTab
            runId={run.id}
            prUrl={run.pr_url}
            verdicts={verdicts}
            events={events}
          />
        </div>
      </div>
    </div>
  );
}

function PrPending({
  run,
  verdicts,
}: {
  run: Run;
  verdicts: Verdict[];
}) {
  return (
    <div className="flex flex-col gap-6 py-4 max-w-xl">
      <div className="flex items-start gap-3">
        <AlertTriangle className="w-5 h-5 text-[var(--warn)] mt-0.5 shrink-0" />
        <div>
          <p className="text-sm text-[var(--fg)] font-medium leading-snug">
            PR will open when verification passes
          </p>
          <p className="mt-1 text-[13px] text-[var(--fg-muted)]">
            Currently{" "}
            <span className="font-mono text-[var(--fg)]">{run.status}</span>
            {run.attempts > 0 && (
              <>
                {" "}
                (attempt{" "}
                <span className="font-mono text-[var(--fg)]">{run.attempts}</span>
                /3)
              </>
            )}
          </p>
        </div>
      </div>
      <CheckStrip verdicts={verdicts} />
    </div>
  );
}

export function PrTab({
  run,
  verdicts,
  events,
}: {
  run: Run;
  verdicts: Verdict[];
  events: Event[];
}) {
  if (run.pr_url) {
    return <PrOpen run={run} verdicts={verdicts} events={events} />;
  }
  return <PrPending run={run} verdicts={verdicts} />;
}
