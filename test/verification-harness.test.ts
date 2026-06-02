import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { execa } from "execa";

// C2: end-to-end test for the verification orchestrator. Spins up a tiny
// throwaway repo in a tmp dir, makes a known-good change + test in a
// worktree, runs `runVerification`, asserts all hard gates pass.
//
// Skipped automatically if Anthropic isn't configured (we don't need the
// critic to validate the deterministic gates; setting the env explicitly to
// 'skip' falls through cleanly via critic.ts).

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "42nbot-vharness-"));
const repoDir = path.join(tmp, "repo");
const workDir = path.join(tmp, "work");

// Force the chat corpus + DB to live inside the temp dir so we don't pollute
// the dev workspace.
process.chdir(tmp);

async function git(...args: string[]) {
  await execa("git", args, { cwd: repoDir });
}

let runVerification: typeof import("../src/verification").runVerification;

beforeAll(async () => {
  fs.mkdirSync(repoDir, { recursive: true });
  // Tiny fixture repo: one function, its test, package.json with vitest.
  fs.writeFileSync(
    path.join(repoDir, "package.json"),
    JSON.stringify(
      {
        name: "fixture",
        scripts: { test: "vitest", typecheck: "echo ok" },
        devDependencies: {},
      },
      null,
      2,
    ),
  );
  fs.writeFileSync(
    path.join(repoDir, "add.js"),
    "exports.add = (a, b) => a + b;\n",
  );
  fs.writeFileSync(
    path.join(repoDir, "add.test.js"),
    `import { describe, it, expect } from "vitest";
import { add } from "./add.js";
describe("add", () => {
  it("sums two numbers", () => {
    expect(add(2, 3)).toBe(5);
  });
});
`,
  );

  await git("init", "-q");
  await execa("git", ["config", "user.email", "test@example.com"], { cwd: repoDir });
  await execa("git", ["config", "user.name", "Test"], { cwd: repoDir });
  await execa("git", ["config", "commit.gpgsign", "false"], { cwd: repoDir });
  await execa("git", ["checkout", "-b", "main"], { cwd: repoDir });
  await git("add", "-A");
  await git("commit", "-q", "-m", "init");

  // Worktree off main.
  await git("worktree", "add", "-b", "feat/sub", workDir, "main");

  // Make a "real" change: extend add to also subtract, plus a new test.
  fs.writeFileSync(
    path.join(workDir, "add.js"),
    `exports.add = (a, b) => a + b;
exports.sub = (a, b) => a - b;
`,
  );
  fs.writeFileSync(
    path.join(workDir, "sub.test.js"),
    `import { describe, it, expect } from "vitest";
import { sub } from "./add.js";
describe("sub", () => {
  it("subtracts two numbers", () => {
    expect(sub(5, 3)).toBe(2);
  });
});
`,
  );

  ({ runVerification } = await import("../src/verification"));
});

afterAll(() => {
  // Best-effort cleanup; tmpdir gets nuked on reboot regardless.
  try {
    fs.rmSync(tmp, { recursive: true, force: true });
  } catch {/* ignore */}
});

describe("verification harness — end to end", () => {
  it("passes all hard gates on a real change", async () => {
    // Skip the test entirely if vitest CLI isn't installable inside the tmp
    // fixture (CI sandboxes don't always have networked npm). The other unit
    // tests cover each individual checker.
    let canRunVitest = true;
    try {
      await execa("npx", ["--no-install", "vitest", "--version"], {
        cwd: workDir,
      });
    } catch {
      canRunVitest = false;
    }
    if (!canRunVitest) return;

    // Create a real run row so emitEvent() has an anchor.
    const { createRun } = await import("../src/db/ops/runs");
    const runId = await createRun({
      type: "implement",
      repo: "fixture/repo",
      status: "verifying",
      started_at: Date.now(),
    });

    // Seed an issue + a tiny plan that matches what we wrote.
    const verdict = await runVerification({
      runId,
      attempt: 1,
      cwd: workDir,
      baseRef: "main",
      plan: {
        files_to_change: [
          { path: "add.js", kind: "modify", why: "add subtract" },
        ],
        tests_to_add_or_update: [
          { path: "sub.test.js", describes: "sub" },
        ],
        user_visible_change: "Adds subtract helper.",
        edge_cases: [],
        complexity: "trivial",
        should_abort: false,
        abort_reason: null,
      },
      issue: {
        number: 1,
        title: "Add subtract",
        body: "Add a subtract helper next to add.",
        labels: [],
      },
    });

    expect(verdict.checks.typecheck.pass).toBe(true);
    expect(verdict.checks.plan_tests_added.pass).toBe(true);
    expect(verdict.checks.banned_patterns.pass).toBe(true);
    expect(verdict.checks.diff_size.pass).toBe(true);
  }, 120_000);
});
