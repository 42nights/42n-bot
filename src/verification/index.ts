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

  // Hard gates first, in series. Typecheck → tests → plan-tests → mutation.
  // If typecheck fails there's no point spending 10 min on a test run.
  const tcheck = await run("typecheck", () => checkTypecheck(args.cwd, hints));
  if (tcheck.pass) {
    await run("existing_tests", () => checkExistingTests(args.cwd, hints));
  } else {
    checks["existing_tests"] = {
      name: "existing_tests",
      pass: false,
      hardGate: true,
      message: "Skipped — typecheck failed.",
    };
  }

  const planTestsCheck = await run("plan_tests_added", () =>
    Promise.resolve(checkPlanTestsAdded(changedFiles, args.plan)),
  );

  if (planTestsCheck.pass && checks.existing_tests.pass) {
    await run("mutation_light", () =>
      checkMutationLight(args.cwd, args.plan, hints),
    );
  } else {
    checks.mutation_light = {
      name: "mutation_light",
      pass: false,
      hardGate: true,
      message: "Skipped — prerequisite checks failed.",
    };
  }

  // D2: lint + diff_size + banned_patterns are independent and cheap. Run in
  // parallel rather than serializing.
  const [lintCheck, diffSizeCheck, bannedCheck] = await Promise.all([
    Promise.resolve().then(async () => {
      emitEvent(args.runId, "verification.check_started", { check: "lint" });
      const r = await checkLint(args.cwd, hints);
      emitEvent(args.runId, "verification.check_completed", {
        check: "lint",
        pass: r.pass,
        message: r.message,
      });
      return r;
    }),
    Promise.resolve().then(() => {
      const r = checkDiffSize(diffText, args.plan);
      emitEvent(args.runId, "verification.check_completed", {
        check: "diff_size",
        pass: r.pass,
        message: r.message,
      });
      return r;
    }),
    Promise.resolve().then(() => {
      const r = checkBannedPatterns(diffText);
      emitEvent(args.runId, "verification.check_completed", {
        check: "banned_patterns",
        pass: r.pass,
        message: r.message,
      });
      return r;
    }),
  ]);
  checks.lint = lintCheck;
  checks.diff_size = diffSizeCheck;
  checks.banned_patterns = bannedCheck;

  // C8: feed the critic the POST-CHANGE test output (mutation-light's `post`)
  // rather than just the existing-tests stdout. That includes the new tests'
  // actual output, which is what the critic needs to judge test depth.
  const mutationDetail = checks.mutation_light.detail as
    | { post?: { tail?: string }; pre?: { tail?: string } }
    | undefined;
  const existingDetail = checks.existing_tests.detail as
    | { stdoutTail?: string }
    | undefined;
  const newTestOutput =
    mutationDetail?.post?.tail ??
    existingDetail?.stdoutTail ??
    checks.existing_tests.message;

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
