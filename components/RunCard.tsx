"use client";

import Link from "next/link";
import { Badge } from "./ui/badge";
import { cn, formatRelative, formatUsd, formatDuration, statusColor } from "@/lib/utils";
import { GitBranch, GitPullRequest, AlertTriangle, CheckCircle2, XCircle, CircleDot, Pause, Bot } from "lucide-react";

export type RunSummary = {
  id: number;
  type: "implement" | "review" | "system";
  repo: string;
  issue_number: number | null;
  issue_title: string | null;
  branch_name: string | null;
  pr_number: number | null;
  pr_url: string | null;
  status: string;
  attempts: number;
  cost_usd: number;
  started_at: number;
  finished_at: number | null;
};

function statusIcon(status: string) {
  switch (status) {
    case "pr-opened":
    case "succeeded":
      return <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" />;
    case "needs-review":
      return <AlertTriangle className="h-3.5 w-3.5 text-amber-600" />;
    case "failed":
      return <XCircle className="h-3.5 w-3.5 text-red-600" />;
    case "abandoned":
      return <Pause className="h-3.5 w-3.5 text-zinc-500" />;
    default:
      return <CircleDot className="h-3.5 w-3.5 text-sky-600 animate-pulse" />;
  }
}

export function RunCard({ run }: { run: RunSummary }) {
  const isActive = ["queued", "planning", "implementing", "verifying", "iterating"].includes(run.status);
  return (
    <Link
      href={`/runs/${run.id}`}
      className={cn(
        "block group rounded-xl border border-border bg-background p-4 hover:border-foreground/30 transition-colors",
        isActive && "border-sky-200 ring-1 ring-sky-100",
      )}
    >
      <div className="flex items-start gap-3">
        <div
          className={cn(
            "shrink-0 w-9 h-9 rounded-md flex items-center justify-center",
            run.type === "review" ? "bg-purple-50 text-purple-600" : "bg-zinc-50 text-zinc-600",
          )}
        >
          {run.type === "review" ? (
            <Bot className="h-4 w-4" />
          ) : (
            <GitBranch className="h-4 w-4" />
          )}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <span className="font-mono">#{run.id}</span>
            <span>·</span>
            <span className="truncate">{run.repo}</span>
            {run.issue_number ? (
              <>
                <span>·</span>
                <span className="font-mono">issue #{run.issue_number}</span>
              </>
            ) : null}
          </div>
          <div className="font-medium text-sm mt-0.5 truncate">
            {run.issue_title ?? (run.type === "review" ? "Codebase review pass" : "Run")}
          </div>
        </div>
        <div className={cn("px-2 py-0.5 rounded border text-[11px] flex items-center gap-1.5", statusColor(run.status))}>
          {statusIcon(run.status)}
          {run.status}
        </div>
      </div>

      <div className="mt-3 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-muted-foreground items-center">
        {run.attempts > 0 && (
          <span>
            attempt {run.attempts}
          </span>
        )}
        <span>{formatUsd(run.cost_usd)}</span>
        <span>{formatRelative(run.started_at)}</span>
        {run.finished_at && (
          <span>· {formatDuration(run.finished_at - run.started_at)}</span>
        )}
        {run.pr_number && (
          <span className="ml-auto inline-flex items-center gap-1 text-emerald-700">
            <GitPullRequest className="h-3 w-3" />
            PR #{run.pr_number}
          </span>
        )}
      </div>
    </Link>
  );
}
