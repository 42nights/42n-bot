"use client";

// Client component: manages tab state and auto-selects based on live run phase.

import { useEffect, useMemo, useState } from "react";
import { useSearchParams, useRouter, usePathname } from "next/navigation";
import {
  Sparkles,
  FileCode,
  GitBranch,
  Terminal,
  GitPullRequest,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { PlanTab } from "./workspace/PlanTab";
import { CodeTab } from "./workspace/CodeTab";
import { DiffTab } from "./workspace/DiffTab";
import { TerminalTab } from "./workspace/TerminalTab";
import { PrTab } from "./workspace/PrTab";

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

type Event = {
  id: string;
  ts: number;
  kind: string;
  payload_json: string;
};

type Verdict = {
  id: string;
  attempt: number;
  pass: number;
  failure_summary: string | null;
  checks_json: string;
};

type Artifact = {
  id: string;
  kind: string;
  bytes?: number;
  created_at?: number;
};

const TABS = ["plan", "code", "diff", "terminal", "pr"] as const;
type Tab = (typeof TABS)[number];

const TAB_META: Record<Tab, { label: string; Icon: React.ComponentType<{ className?: string }> }> = {
  plan: { label: "Plan", Icon: Sparkles },
  code: { label: "Code", Icon: FileCode },
  diff: { label: "Diff", Icon: GitBranch },
  terminal: { label: "Terminal", Icon: Terminal },
  pr: { label: "PR", Icon: GitPullRequest },
};

function pickDefault(status: string, hasPr: boolean): Tab {
  if (hasPr || status === "pr-opened" || status === "succeeded") return "pr";
  if (status === "verifying") return "terminal";
  if (status === "implementing" || status === "iterating") return "code";
  return "plan";
}

export function SessionWorkspace({
  run,
  events,
  verdicts,
  isLive,
  artifacts,
}: {
  run: Run;
  events: Event[];
  verdicts: Verdict[];
  isLive: boolean;
  artifacts?: Artifact[];
}) {
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();

  const queryTab = searchParams.get("tab") as Tab | null;
  const validQuery =
    queryTab && (TABS as readonly string[]).includes(queryTab) ? queryTab : null;

  const defaultTab = useMemo(
    () => pickDefault(run.status, !!run.pr_url),
    [run.status, run.pr_url],
  );

  const [tab, setTab] = useState<Tab>(validQuery ?? defaultTab);

  // Auto-advance tab when run status changes (but only if user hasn't manually overridden)
  const [userOverride, setUserOverride] = useState(!!validQuery);
  useEffect(() => {
    if (!isLive) return;
    if (userOverride) return;
    setTab(defaultTab);
  }, [defaultTab, isLive, userOverride]);

  // Sync query param on user tab change
  function handleTabClick(t: Tab) {
    setTab(t);
    setUserOverride(true);
    const params = new URLSearchParams(searchParams.toString());
    params.set("tab", t);
    router.replace(`${pathname}?${params.toString()}`, { scroll: false });
  }

  return (
    <div className="flex flex-col h-full">
      {/* Tab strip */}
      <div className="px-4 border-b border-[var(--border)] flex gap-0.5 bg-[var(--bg)] shrink-0">
        {TABS.map((t) => {
          const { label, Icon } = TAB_META[t];
          const active = tab === t;
          return (
            <button
              key={t}
              onClick={() => handleTabClick(t)}
              aria-selected={active}
              role="tab"
              className={cn(
                "inline-flex items-center gap-1.5 px-3 h-10 text-[11px] uppercase tracking-[0.14em] relative transition-colors select-none",
                active
                  ? "text-[var(--fg)]"
                  : "text-[var(--fg-muted)] hover:text-[var(--fg)]",
              )}
            >
              <Icon className="w-3 h-3 shrink-0" />
              {label}
              {active && (
                <span className="absolute bottom-0 left-3 right-3 h-px bg-[var(--accent)]" />
              )}
            </button>
          );
        })}
      </div>

      {/* Tab content */}
      <div className="flex-1 min-h-0 overflow-y-auto">
        {tab === "plan" && (
          <div className="px-5 py-4">
            <PlanTab events={events} />
          </div>
        )}
        {tab === "code" && (
          <div className="h-full">
            <CodeTab runId={run.id} events={events} />
          </div>
        )}
        {tab === "diff" && (
          <div className="h-full">
            <DiffTab
              runId={run.id}
              prUrl={run.pr_url}
              verdicts={verdicts}
              events={events}
            />
          </div>
        )}
        {tab === "terminal" && (
          <div className="h-full">
            <TerminalTab events={events} artifacts={artifacts ?? []} />
          </div>
        )}
        {tab === "pr" && (
          <div className="px-5 py-4">
            <PrTab run={run} verdicts={verdicts} events={events} />
          </div>
        )}
      </div>
    </div>
  );
}
