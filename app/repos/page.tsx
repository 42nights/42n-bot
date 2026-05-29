"use client";

import useSWR from "swr";
import { fetcher } from "@/lib/api-client";
import { Badge } from "@/components/ui/badge";

type RepoCfg = { owner: string; name: string; defaultBranch: string; enabled: boolean };

export default function Repos() {
  const { data } = useSWR<{
    repos: RepoCfg[];
    labels: Record<string, string>;
    verification: { maxIterations: number; diffMaxLines: number; criticMinConfidence: number };
    budgets: { perRunUsd: number; perDayUsd: number; perIssueUsd: number };
    reviewer: { enabled: boolean; intervalMinutes: number; maxIssuesPerRun: number; duplicateThreshold: number };
    demoMode: boolean;
  }>("/api/repos", fetcher);
  if (!data) return <div className="p-10 text-sm text-muted-foreground">Loading…</div>;
  return (
    <div className="max-w-3xl mx-auto px-8 py-10">
      <header className="mb-8">
        <h1 className="font-serif text-3xl tracking-tight">Repos</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Repositories the bot is watching, plus the policy it applies.
        </p>
      </header>

      {data.demoMode && (
        <div className="mb-6 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          <strong>Demo mode</strong> is on — real GitHub calls are stubbed and the DB
          contains seeded sample runs for the dashboard walkthrough.
        </div>
      )}

      <section className="space-y-3 mb-10">
        {data.repos.map((r) => (
          <div
            key={`${r.owner}/${r.name}`}
            className="rounded-lg border border-border bg-background p-4 flex items-center gap-3"
          >
            <div className="flex-1 min-w-0">
              <div className="font-medium text-sm">
                {r.owner}/{r.name}
              </div>
              <div className="text-xs text-muted-foreground">
                base branch · <span className="font-mono">{r.defaultBranch}</span>
              </div>
            </div>
            <Badge variant={r.enabled ? "success" : "default"}>
              {r.enabled ? "enabled" : "paused"}
            </Badge>
          </div>
        ))}
      </section>

      <section className="grid md:grid-cols-2 gap-6">
        <div>
          <h2 className="text-xs uppercase tracking-wider text-muted-foreground mb-2">
            Verification policy
          </h2>
          <KV label="Max iterations" value={String(data.verification.maxIterations)} />
          <KV label="Diff line cap" value={String(data.verification.diffMaxLines)} />
          <KV label="Critic min confidence" value={`${data.verification.criticMinConfidence}/100`} />
        </div>
        <div>
          <h2 className="text-xs uppercase tracking-wider text-muted-foreground mb-2">
            Budgets
          </h2>
          <KV label="Per run" value={`$${data.budgets.perRunUsd.toFixed(2)}`} />
          <KV label="Per issue" value={`$${data.budgets.perIssueUsd.toFixed(2)}`} />
          <KV label="Per day" value={`$${data.budgets.perDayUsd.toFixed(2)}`} />
        </div>
        <div>
          <h2 className="text-xs uppercase tracking-wider text-muted-foreground mb-2">
            Reviewer
          </h2>
          <KV label="Enabled" value={data.reviewer.enabled ? "yes" : "no"} />
          <KV label="Interval" value={`${data.reviewer.intervalMinutes} min`} />
          <KV label="Max issues / run" value={String(data.reviewer.maxIssuesPerRun)} />
          <KV label="Dedupe threshold" value={data.reviewer.duplicateThreshold.toFixed(2)} />
        </div>
        <div>
          <h2 className="text-xs uppercase tracking-wider text-muted-foreground mb-2">
            Labels
          </h2>
          {Object.entries(data.labels).map(([k, v]) => (
            <KV key={k} label={k} value={<code className="font-mono text-xs">{v}</code>} />
          ))}
        </div>
      </section>
    </div>
  );
}

function KV({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between text-sm border-b border-border py-1.5">
      <span className="text-muted-foreground">{label}</span>
      <span>{value}</span>
    </div>
  );
}
