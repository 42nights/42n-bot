"use client";

import { use } from "react";
import Link from "next/link";
import useSWR from "swr";
import { fetcher, cancelRun } from "@/lib/api-client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EventStream } from "@/components/EventStream";
import { VerdictReport } from "@/components/VerdictReport";
import { DiffView } from "@/components/DiffView";
import { formatDuration, formatRelative, formatUsd, statusColor } from "@/lib/utils";
import { ArrowLeft, ExternalLink, GitPullRequest } from "lucide-react";
import { toast } from "sonner";

type Run = {
  id: number;
  type: string;
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
  id: number;
  attempt: number;
  pass: number;
  checks_json: string;
  failure_summary: string | null;
};

export default function RunDetail({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const { data, mutate } = useSWR<{
    run: Run;
    events: any[];
    verdicts: Verdict[];
    artifacts: Array<{ id: number; kind: string; bytes: number; created_at: number }>;
  }>(`/api/runs/${id}`, fetcher, { refreshInterval: 4000 });

  const { data: diffData } = useSWR<{ diff: string }>(
    `/api/runs/${id}/diff`,
    fetcher,
  );

  if (!data) return <div className="p-10 text-sm text-muted-foreground">Loading…</div>;
  const { run, events, verdicts } = data;
  const isActive = [
    "queued",
    "planning",
    "implementing",
    "verifying",
    "iterating",
  ].includes(run.status);

  return (
    <div className="max-w-5xl mx-auto px-8 py-10">
      <Link
        href="/runs"
        className="inline-flex items-center gap-1 text-xs uppercase tracking-wider text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="h-3.5 w-3.5" /> All runs
      </Link>

      <header className="mt-4 flex items-start gap-4">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <span className="font-mono">run #{run.id}</span>
            <span>·</span>
            <span>{run.repo}</span>
            {run.issue_number && (
              <>
                <span>·</span>
                <span className="font-mono">issue #{run.issue_number}</span>
              </>
            )}
          </div>
          <h1 className="font-serif text-2xl mt-1">
            {run.issue_title ?? "Run"}
          </h1>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <Badge variant={
              run.status === "pr-opened" || run.status === "succeeded"
                ? "success"
                : run.status === "needs-review"
                  ? "warning"
                  : run.status === "failed"
                    ? "error"
                    : isActive
                      ? "info"
                      : "default"
            }>
              {run.status}
            </Badge>
            <span className="text-xs text-muted-foreground">
              {run.attempts > 0 ? `${run.attempts} attempt(s)` : "—"} ·{" "}
              {formatUsd(run.cost_usd)} ·{" "}
              {formatRelative(run.started_at)}
              {run.finished_at && ` · ${formatDuration(run.finished_at - run.started_at)}`}
            </span>
          </div>
        </div>
        <div className="flex flex-col gap-2 items-end">
          {run.pr_url && (
            <a
              href={run.pr_url}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1.5 text-sm text-emerald-700 hover:underline"
            >
              <GitPullRequest className="h-4 w-4" />
              PR #{run.pr_number}
              <ExternalLink className="h-3 w-3" />
            </a>
          )}
          {isActive && (
            <Button
              variant="outline"
              size="sm"
              onClick={async () => {
                try {
                  await cancelRun(run.id);
                  toast.success("Cancelled");
                  mutate();
                } catch (err) {
                  toast.error((err as Error).message);
                }
              }}
            >
              Cancel
            </Button>
          )}
        </div>
      </header>

      {run.error_message && (
        <div className="mt-4 text-xs text-red-700 bg-red-50 border border-red-200 px-3 py-2 rounded">
          {run.error_message}
        </div>
      )}

      <section className="mt-8">
        <h2 className="text-sm font-medium uppercase tracking-wider text-muted-foreground mb-2">
          Activity
        </h2>
        <EventStream runId={run.id} initialEvents={events} live={isActive} />
      </section>

      {verdicts.length > 0 && (
        <section className="mt-8 space-y-6">
          <h2 className="text-sm font-medium uppercase tracking-wider text-muted-foreground">
            Verdicts ({verdicts.length})
          </h2>
          {verdicts.map((v) => (
            <VerdictReport
              key={v.id}
              verdict={{
                pass: !!v.pass,
                attempt: v.attempt,
                failureSummary: v.failure_summary ?? "",
                checks: JSON.parse(v.checks_json),
              }}
            />
          ))}
        </section>
      )}

      {diffData?.diff && (
        <section className="mt-8">
          <div className="flex items-center justify-between mb-2">
            <h2 className="text-sm font-medium uppercase tracking-wider text-muted-foreground">
              Diff
            </h2>
            <Link
              href={`/runs/${run.id}/diff`}
              className="text-xs text-muted-foreground hover:text-foreground"
            >
              Open full diff →
            </Link>
          </div>
          <DiffView diff={diffData.diff.split("\n").slice(0, 200).join("\n")} />
        </section>
      )}

      {run.issue_body && (
        <section className="mt-8">
          <h2 className="text-sm font-medium uppercase tracking-wider text-muted-foreground mb-2">
            Issue body
          </h2>
          <pre className="text-xs whitespace-pre-wrap bg-muted/40 rounded-md p-4 border border-border max-h-[40vh] overflow-y-auto leading-relaxed">
            {run.issue_body}
          </pre>
        </section>
      )}
    </div>
  );
}
