import { Octokit } from "@octokit/rest";
import { retry } from "@octokit/plugin-retry";

// B7: enable plugin-retry so a single 502/503/504 from GitHub doesn't drop
// the whole run. Default policy is exponential backoff up to 3 retries on
// 5xx; safe for everything we do (all our writes are idempotent).
const OctokitWithRetry = Octokit.plugin(retry);

let _octokit: InstanceType<typeof OctokitWithRetry> | null = null;
export function gh(): InstanceType<typeof OctokitWithRetry> {
  if (!process.env.GITHUB_TOKEN) {
    throw new Error("GITHUB_TOKEN is not set");
  }
  if (!_octokit) {
    _octokit = new OctokitWithRetry({
      auth: process.env.GITHUB_TOKEN,
      userAgent: "42n-bot/0.1",
      retry: { doNotRetry: [401, 403, 404, 422] },
    });
  }
  return _octokit;
}

export type IssueSummary = {
  number: number;
  title: string;
  body: string;
  labels: string[];
  state: "open" | "closed";
  url: string;
  /** ISO timestamp from GitHub — used to invalidate the dedupe embedding cache. */
  updated_at: string;
};

type RawIssue = {
  number: number;
  title: string;
  body?: string | null;
  labels?: Array<string | { name?: string }>;
  state: string;
  html_url: string;
  updated_at: string;
  pull_request?: unknown;
};

function toSummary(i: RawIssue): IssueSummary {
  return {
    number: i.number,
    title: i.title,
    body: i.body ?? "",
    labels: (i.labels ?? []).map((l) =>
      typeof l === "string" ? l : (l.name ?? ""),
    ),
    state: i.state as "open" | "closed",
    url: i.html_url,
    updated_at: i.updated_at,
  };
}

export async function listLabeledIssues(args: {
  owner: string;
  repo: string;
  label: string;
}): Promise<IssueSummary[]> {
  const res = await gh().issues.listForRepo({
    owner: args.owner,
    repo: args.repo,
    labels: args.label,
    state: "open",
    sort: "created",
    direction: "asc",
    per_page: 50,
  });
  return (res.data as RawIssue[])
    .filter((i) => !i.pull_request)
    .map(toSummary);
}

/**
 * A10: paginate to the full open-issue set, capped at 500. Without this, the
 * reviewer's dedupe gets silently truncated at 100 — old issues drop out and
 * the bot starts filing duplicates.
 */
export async function listAllOpenIssues(args: {
  owner: string;
  repo: string;
  cap?: number;
}): Promise<IssueSummary[]> {
  const cap = args.cap ?? 500;
  const all: IssueSummary[] = [];
  const iterator = gh().paginate.iterator(gh().issues.listForRepo, {
    owner: args.owner,
    repo: args.repo,
    state: "open",
    per_page: 100,
  });
  for await (const page of iterator) {
    for (const i of page.data as RawIssue[]) {
      if (i.pull_request) continue;
      all.push(toSummary(i));
      if (all.length >= cap) return all;
    }
  }
  return all;
}

export async function addLabel(args: {
  owner: string;
  repo: string;
  issue_number: number;
  label: string;
}) {
  await gh().issues.addLabels({
    owner: args.owner,
    repo: args.repo,
    issue_number: args.issue_number,
    labels: [args.label],
  });
}

export async function removeLabel(args: {
  owner: string;
  repo: string;
  issue_number: number;
  label: string;
}) {
  try {
    await gh().issues.removeLabel({
      owner: args.owner,
      repo: args.repo,
      issue_number: args.issue_number,
      name: args.label,
    });
  } catch {
    /* label may already be absent — fine */
  }
}

export async function commentOnIssue(args: {
  owner: string;
  repo: string;
  issue_number: number;
  body: string;
}) {
  await gh().issues.createComment({
    owner: args.owner,
    repo: args.repo,
    issue_number: args.issue_number,
    body: args.body,
  });
}

export async function openPullRequest(args: {
  owner: string;
  repo: string;
  head: string;
  base: string;
  title: string;
  body: string;
  labels?: string[];
}): Promise<{ number: number; url: string }> {
  const created = await gh().pulls.create({
    owner: args.owner,
    repo: args.repo,
    head: args.head,
    base: args.base,
    title: args.title,
    body: args.body,
    draft: false,
  });
  if (args.labels?.length) {
    await gh().issues.addLabels({
      owner: args.owner,
      repo: args.repo,
      issue_number: created.data.number,
      labels: args.labels,
    });
  }
  return { number: created.data.number, url: created.data.html_url };
}

export async function createBotIssue(args: {
  owner: string;
  repo: string;
  title: string;
  body: string;
  labels?: string[];
}): Promise<{ number: number; url: string }> {
  const created = await gh().issues.create({
    owner: args.owner,
    repo: args.repo,
    title: args.title,
    body: args.body,
    labels: args.labels,
  });
  return { number: created.data.number, url: created.data.html_url };
}
