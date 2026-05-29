import type { CheckResult, Plan, Verdict, CheckName } from "./types";
import { detectToolchain } from "./detect";
import { checkTypecheck } from "./typecheck";
import { checkExistingTests } from "./tests";
import { checkLint } from "./lint";
import { checkBannedPatterns } from "./banned";
import {
  checkDiffSize,
  checkPlanTestsAdded,
  getChangedFiles,
  getDiffText,
} from "./diff";
import { checkMutationLight } from "./mutation";
import { checkCritic } from "./critic";
import type { IssueForPrompt } from "../claude/prompts";
import { emitEvent } from "../shared/events";
import { db } from "../db";

export type RunVerificationArgs = {
  runId: number;
  attempt: number;
  cwd: string;
  baseRef: string;
  plan: Plan;
  issue: IssueForPrompt;
};

export async function runVerification(
  args: RunVerificationArgs,
): Promise<Verdict> {
  emitEvent(args.runId, "verification.started", { attempt: args.attempt });
  const hints = detectToolchain(args.cwd);

  const diffText = await getDiffText(args.cwd, args.baseRef);
  const changedFiles = await getChangedFiles(args.cwd, args.baseRef);

  // Run hard gates in series so we short-circuit when something obvious fails.
  // (Tests can be slow; if typecheck fails there's no point spending 10 min
  // on a test run that's about to compile-error anyway.)
  const checks: Record<CheckName, CheckResult> = {} as Record<CheckName, CheckResult>;

  async function run(name: CheckName, fn: () => Promise<CheckResult>) {
    emitEvent(args.runId, "verification.check_started", { check: name });
    const r = await fn();
    checks[name] = r;
    emitEvent(args.runId, "verification.check_completed", {
      check: name,
      pass: r.pass,
      message: r.message,
    });
    return r;
  }

  const tcheck = await run("typecheck", () => checkTypecheck(args.cwd, hints));
  const testsCheck = tcheck.pass
    ? await run("existing_tests", () => checkExistingTests(args.cwd, hints))
    : (checks["existing_tests"] = {
        name: "existing_tests",
        pass: false,
        hardGate: true,
        message: "Skipped — typecheck failed.",
      });
  void testsCheck;

  const planTestsCheck = await run("plan_tests_added", () =>
    Promise.resolve(checkPlanTestsAdded(changedFiles, args.plan)),
  );

  if (planTestsCheck.pass && checks.existing_tests.pass) {
    await run("mutation_light", () => checkMutationLight(args.cwd, args.plan, hints));
  } else {
    checks.mutation_light = {
      name: "mutation_light",
      pass: false,
      hardGate: true,
      message: "Skipped — prerequisite checks failed.",
    };
  }

  await run("lint", () => checkLint(args.cwd, hints));
  checks.diff_size = checkDiffSize(diffText, args.plan);
  emitEvent(args.runId, "verification.check_completed", {
    check: "diff_size",
    pass: checks.diff_size.pass,
    message: checks.diff_size.message,
  });
  checks.banned_patterns = checkBannedPatterns(diffText);
  emitEvent(args.runId, "verification.check_completed", {
    check: "banned_patterns",
    pass: checks.banned_patterns.pass,
    message: checks.banned_patterns.message,
  });

  // Critic gets the new test output for context.
  const newTestOutput =
    typeof checks.existing_tests.detail === "object" &&
    checks.existing_tests.detail !== null &&
    "stdoutTail" in checks.existing_tests.detail
      ? String(
          (checks.existing_tests.detail as { stdoutTail: string }).stdoutTail,
        )
      : checks.existing_tests.message;
  await run("critic", () =>
    checkCritic({
      issue: args.issue,
      plan: args.plan,
      diffText,
      newTestOutput,
    }),
  );

  const hardFailures = Object.values(checks).filter(
    (c) => c.hardGate && !c.pass,
  );
  const softFailures = Object.values(checks).filter(
    (c) => !c.hardGate && !c.pass,
  );

  const pass = hardFailures.length === 0 && checks.critic.pass !== false;

  const failureSummary = pass
    ? "All gates passed."
    : [
        ...hardFailures.map((c) => `[HARD] ${c.name}: ${c.message}`),
        ...softFailures.map((c) => `[soft] ${c.name}: ${c.message}`),
      ].join("\n");

  emitEvent(args.runId, "verification.completed", {
    attempt: args.attempt,
    pass,
    hardFailures: hardFailures.length,
    softFailures: softFailures.length,
  });

  // Persist verdict.
  db.prepare(
    `INSERT INTO verdicts (run_id, attempt, pass, checks_json, failure_summary, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(
    args.runId,
    args.attempt,
    pass ? 1 : 0,
    JSON.stringify(checks),
    failureSummary,
    Date.now(),
  );

  return {
    pass,
    checks,
    failureSummary,
    attempt: args.attempt,
  };
}
