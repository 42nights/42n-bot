import { Octokit } from "@octokit/rest";

let _octokit: Octokit | null = null;
export function gh(): Octokit {
  if (!process.env.GITHUB_TOKEN) {
    throw new Error("GITHUB_TOKEN is not set");
  }
  if (!_octokit) {
    _octokit = new Octokit({
      auth: process.env.GITHUB_TOKEN,
      userAgent: "42n-bot/0.1",
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
};

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
  return res.data
    .filter((i) => !i.pull_request) // exclude PRs (listForRepo returns both)
    .map((i) => ({
      number: i.number,
      title: i.title,
      body: i.body ?? "",
      labels: (i.labels ?? []).map((l) =>
        typeof l === "string" ? l : l.name ?? "",
      ),
      state: i.state as "open" | "closed",
      url: i.html_url,
    }));
}

export async function listAllOpenIssues(args: {
  owner: string;
  repo: string;
}): Promise<IssueSummary[]> {
  const res = await gh().issues.listForRepo({
    owner: args.owner,
    repo: args.repo,
    state: "open",
    per_page: 100,
  });
  return res.data
    .filter((i) => !i.pull_request)
    .map((i) => ({
      number: i.number,
      title: i.title,
      body: i.body ?? "",
      labels: (i.labels ?? []).map((l) =>
        typeof l === "string" ? l : l.name ?? "",
      ),
      state: i.state as "open" | "closed",
      url: i.html_url,
    }));
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
