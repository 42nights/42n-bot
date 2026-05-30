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
    // v2 overhaul: bot tried and could not reproduce. Honest abort.
    cantReproduce: "bot-cant-reproduce",
    // v2 overhaul: design produced; awaiting `@bot proceed` confirmation.
    confirmDesign: "bot-confirm-design",
  },

  /**
   * v2 overhaul §7.2 — scoped Bash allowlist for the implementer subprocess.
   * Replaces unconditional `Bash`. Each entry is passed directly to the
   * Claude CLI's `--allowedTools` glob syntax.
   *
   * What's NOT here (intentional):
   *  - `git commit/push/checkout/reset`: orchestrator owns git state
   *  - `curl https://...`: no arbitrary external network
   *  - `rm -rf`: never
   *  - `npm install`: orchestrator-managed; model edits package.json instead
   */
  allowedTools: [
    // File IO
    "Read",
    "Edit",
    "Write",
    "MultiEdit",
    "Glob",
    "Grep",

    // Package + test runners (scoped)
    "Bash(npm *)",
    "Bash(npx *)",
    "Bash(node *)",
    "Bash(pnpm *)",
    "Bash(jest *)",
    "Bash(vitest *)",
    "Bash(pytest *)",
    "Bash(go test *)",
    "Bash(cargo *)",
    "Bash(tsc *)",
    "Bash(eslint *)",
    "Bash(prettier *)",

    // Git, READ-ONLY (orchestrator owns commits)
    "Bash(git status *)",
    "Bash(git diff *)",
    "Bash(git log *)",
    "Bash(git show *)",
    "Bash(git ls-files *)",
    "Bash(git branch *)",

    // Filesystem inspection
    "Bash(ls *)",
    "Bash(cat *)",
    "Bash(head *)",
    "Bash(tail *)",
    "Bash(find *)",
    "Bash(grep *)",
    "Bash(rg *)",
    "Bash(wc *)",
    "Bash(mkdir *)",
    "Bash(rm -f *)",

    // Runtime smoke (LOCAL ONLY — for v2 runtime verification phase).
    // Globs intentionally constrain the host. NEVER add `curl -s *` or
    // `curl https://*` — both let the model exfiltrate to arbitrary hosts.
    // NEVER add `sqlite3 data/* *` — gives arbitrary SQL on the bot's own DB.
    "Bash(curl http://localhost:* *)",
    "Bash(curl http://127.0.0.1:* *)",
    "Bash(curl -X * http://localhost:* *)",
    "Bash(curl -X * http://127.0.0.1:* *)",
    "Bash(curl -i http://localhost:* *)",
    "Bash(curl -i http://127.0.0.1:* *)",
  ] as string[],

  claudeCode: {
    bin: process.env.CLAUDE_CODE_PATH ?? "claude",
    defaultTimeoutMs: 600_000,
    plannerTimeoutMs: 180_000,
    criticTimeoutMs: 120_000,
    // REPRODUCE is not a pure-reasoning planner call — it writes a test, RUNS
    // it, and iterates to confirm a real failure before emitting JSON. That
    // agentic test-loop is variable and intermittently blew past the 180s
    // planner cap (e.g. run #94), so it got the wrong, too-tight budget. Give
    // it test-running class time. Still non-fatal if it times out (falls
    // through to PLAN), so a generous cap is safe.
    reproduceTimeoutMs: 420_000,
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
    // v2 overhaul: per-criterion minimum verdict to allow ship-without-review.
    // Any criterion below this drops the run to needs-review even if the
    // overall confidence is high.
    criticV2MinPerCriterionVerdict: "probably_yes" as
      | "clearly_yes"
      | "probably_yes",
  },

  /**
   * v2 overhaul §3 — confidence threshold below which the UNDERSTAND phase
   * aborts instead of proceeding.
   */
  understanding: {
    minConfidenceToProceed: 60,
  },

  /**
   * v2 overhaul §7.1 — implementer can request plan revision when it
   * discovers the plan is wrong. Capped to prevent loops.
   */
  replan: {
    maxPerRun: 2,
  },

  reviewer: {
    // Env override so the scheduled reviewer can be turned off without a code
    // change (e.g. to give the implementer the full CLI/budget during a demo,
    // or on a deploy that should only fix tagged issues, not file new ones).
    enabled: process.env.REVIEWER_ENABLED !== "0",
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
};

export type BotConfig = typeof botConfig;
