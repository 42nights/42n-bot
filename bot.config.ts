import path from "node:path";
import os from "node:os";

export type BotRepo = {
  owner: string;
  name: string;
  defaultBranch: string;
  enabled: boolean;
};

export const botConfig = {
  repos: [
    {
      owner: "42nights",
      name: "dataroom",
      defaultBranch: "main",
      enabled: true,
    },
  ] as BotRepo[],

  labels: {
    request: "bot-please",
    claimed: "bot-claimed",
    needsReview: "bot-needs-review",
    botFound: "bot-found",
  },

  claudeCode: {
    bin: process.env.CLAUDE_CODE_PATH ?? "claude",
    defaultTimeoutMs: 600_000,
    plannerTimeoutMs: 180_000,
    criticTimeoutMs: 120_000,
  },

  verification: {
    maxIterations: 3,
    diffMaxLines: 1000,
    bannedPatterns: [
      /@ts-ignore/,
      /eslint-disable-next-line/,
      /\bit\.skip\b/,
      /\bxit\b/,
      /\bdescribe\.skip\b/,
    ],
    criticMinConfidence: 60,
  },

  reviewer: {
    enabled: true,
    intervalMinutes: 360,
    maxIssuesPerRun: 3,
    duplicateThreshold: 0.78,
  },

  budgets: {
    perRunUsd: 5,
    perDayUsd: 50,
    perIssueUsd: 10,
  },

  workspaceRoot:
    process.env.WORKTREE_ROOT ??
    path.join(os.homedir(), ".42n-bot", "worktrees"),

  dashboard: {
    url: process.env.DASHBOARD_URL ?? "http://localhost:3000",
  },

  demoMode: process.env.DEMO_MODE === "1",
};

export type BotConfig = typeof botConfig;
