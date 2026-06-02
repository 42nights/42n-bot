import { NextRequest, NextResponse } from "next/server";
import { activeRepos } from "@/src/repo-store";
import { listLabeledIssues, type IssueSummary } from "@/src/github/client";
import { botConfig } from "@/bot.config";
import { getRunsByRepoAndIssues } from "@/src/db/ops/runs";
import { log } from "@/src/shared/logger";

export const runtime = "nodejs";

type IssueRow = IssueSummary & {
  repo: string;
  owner: string;
  name: string;
  source: "bot-found" | "bot-please" | "both";
  severity: "low" | "medium" | "high" | null;
  type: string | null;
  run_id: string | null;
  run_status: string | null;
  pr_number: number | null;
  pr_url: string | null;
};

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const repoFilter = url.searchParams.get("repo");

  let repos = (await activeRepos()).filter((r) => r.enabled);
  if (repoFilter) {
    repos = repos.filter((r) => `${r.owner}/${r.name}` === repoFilter);
  }
  if (repos.length === 0) {
    return NextResponse.json({ issues: [], repos: 0 });
  }

  const out: IssueRow[] = [];

  for (const repo of repos) {
    try {
      const [found, requested] = await Promise.all([
        listLabeledIssues({ owner: repo.owner, repo: repo.name, label: botConfig.labels.botFound }),
        listLabeledIssues({ owner: repo.owner, repo: repo.name, label: botConfig.labels.request }),
      ]);

      const byNum = new Map<number, IssueRow>();
      const repoFull = `${repo.owner}/${repo.name}`;
      for (const i of found) {
        byNum.set(i.number, {
          ...i,
          repo: repoFull,
          owner: repo.owner,
          name: repo.name,
          source: "bot-found",
          severity: parseSeverity(i.body),
          type: parseType(i.body),
          run_id: null,
          run_status: null,
          pr_number: null,
          pr_url: null,
        });
      }
      for (const i of requested) {
        const existing = byNum.get(i.number);
        if (existing) {
          existing.source = "both";
        } else {
          byNum.set(i.number, {
            ...i,
            repo: repoFull,
            owner: repo.owner,
            name: repo.name,
            source: "bot-please",
            severity: parseSeverity(i.body),
            type: parseType(i.body),
            run_id: null,
            run_status: null,
            pr_number: null,
            pr_url: null,
          });
        }
      }

      const rows = Array.from(byNum.values());
      if (rows.length > 0) {
        const issueNumbers = rows.map((r) => r.number);
        const runRows = await getRunsByRepoAndIssues(repoFull, issueNumbers);
        const latestRunByIssue = new Map<
          number,
          { _id: string; status: string; pr_number: number | null; pr_url: string | null }
        >();
        for (const run of runRows) {
          if (run.issue_number !== undefined && !latestRunByIssue.has(run.issue_number)) {
            latestRunByIssue.set(run.issue_number, {
              _id: run._id,
              status: run.status,
              pr_number: run.pr_number ?? null,
              pr_url: run.pr_url ?? null,
            });
          }
        }
        for (const r of rows) {
          const run = latestRunByIssue.get(r.number);
          if (run) {
            r.run_id = run._id;
            r.run_status = run.status;
            r.pr_number = run.pr_number;
            r.pr_url = run.pr_url;
          }
        }
      }

      out.push(...rows);
    } catch (err) {
      log.warn("issues", `failed to list issues for ${repo.owner}/${repo.name}: ${err}`);
    }
  }

  const severityWeight = { high: 3, medium: 2, low: 1 } as const;
  out.sort((a, b) => {
    const aActive = isActiveStatus(a.run_status) ? 1 : 0;
    const bActive = isActiveStatus(b.run_status) ? 1 : 0;
    if (aActive !== bActive) return bActive - aActive;
    const aw = a.severity ? severityWeight[a.severity] : 0;
    const bw = b.severity ? severityWeight[b.severity] : 0;
    if (aw !== bw) return bw - aw;
    return b.updated_at.localeCompare(a.updated_at);
  });

  return NextResponse.json({ issues: out, repos: repos.length });
}

const ACTIVE = new Set(["queued", "planning", "implementing", "verifying", "iterating"]);
function isActiveStatus(s: string | null): boolean {
  return !!s && ACTIVE.has(s);
}

const SEVERITY_RE = /\*\*Severity:\*\*\s*(low|medium|high)/i;
const TYPE_RE = /\*\*Type:\*\*\s*([a-z-]+)/i;
function parseSeverity(body: string): IssueRow["severity"] {
  const m = body.match(SEVERITY_RE);
  if (!m) return null;
  const v = m[1].toLowerCase();
  return v === "low" || v === "medium" || v === "high" ? v : null;
}
function parseType(body: string): string | null {
  const m = body.match(TYPE_RE);
  return m ? m[1].toLowerCase() : null;
}
