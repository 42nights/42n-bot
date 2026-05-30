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
import { checkAcceptanceTests, readTestCode } from "./acceptance";
import { checkCriticV2 } from "./critic2";
import { checkRuntime } from "./runtime/index";
import type { IssueForPrompt } from "../claude/prompts";
import type { Understanding, CriticV2Report } from "../claude/phases/types";
import { emitEvent } from "../shared/events";
import { db } from "../db";
import { log } from "../shared/logger";

export type RunVerificationArgs = {
  runId: number;
  attempt: number;
  cwd: string;
  baseRef: string;
  plan: Plan;
  issue: IssueForPrompt;
  // ── v2 overhaul additions (all optional for back-compat) ──────────────
  understanding?: Understanding | null;
  acceptancePaths?: string[];
  /**
   * When true, run critic_v2 instead of the v1 critic. Falls back to v1
   * silently if `understanding` isn't provided (v2 needs acceptance
   * criteria from understanding to do its work).
   */
  useCriticV2?: boolean;
};

/**
 * Convenience wrapper for a CheckResult that's just a "this check was
 * skipped" placeholder so the Verdict's `checks` map stays exhaustive across
 * all CheckName entries.
 */
function skipped(name: CheckName, message: string): CheckResult {
  return { name, pass: true, hardGate: false, message };
}

export async function runVerification(
  args: RunVerificationArgs,
): Promise<Verdict & { criticV2?: CriticV2Report; runtimeOk?: boolean }> {
  emitEvent(args.runId, "verification.started", { attempt: args.attempt });
  const hints = detectToolchain(args.cwd);

  const diffText = await getDiffText(args.cwd, args.baseRef);
  const changedFiles = await getChangedFiles(args.cwd, args.baseRef);

  const checks: Record<CheckName, CheckResult> = {} as Record<
    CheckName,
    CheckResult
  >;

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

  // ── Hard-gate sequence ────────────────────────────────────────────────
  // typecheck → existing_tests → plan_tests → mutation_light → acceptance →
  // runtime_verification. Each blocks the next when it fails (no point
  // smoke-testing endpoints when the build is broken).

  const tcheck = await run("typecheck", () => checkTypecheck(args.cwd, hints));
  if (tcheck.pass) {
    await run("existing_tests", () => checkExistingTests(args.cwd, hints));
  } else {
    checks.existing_tests = {
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

  // v2 §8.1 — acceptance tests. Only meaningful when paths were provided.
  if (args.acceptancePaths && args.acceptancePaths.length > 0) {
    if (checks.existing_tests.pass) {
      await run("acceptance_tests", () =>
        checkAcceptanceTests(args.cwd, hints, args.acceptancePaths!),
      );
    } else {
      checks.acceptance_tests = {
        name: "acceptance_tests",
        pass: false,
        hardGate: true,
        message: "Skipped — existing tests already broken.",
      };
    }
  } else {
    checks.acceptance_tests = skipped(
      "acceptance_tests",
      "No acceptance paths declared — pre-v2 run.",
    );
  }

  // v2 §8.2 — runtime verification. Only runs when understanding declared a
  // runtime surface. Hard-gates when it fails.
  const runtimeSurface = args.understanding?.runtime_surface;
  const hasRuntimeSurface =
    runtimeSurface &&
    (runtimeSurface.starts_dev_server ||
      runtimeSurface.adds_or_modifies_endpoints.length > 0 ||
      runtimeSurface.adds_migration);
  if (hasRuntimeSurface && checks.existing_tests.pass) {
    await run("runtime_verification", () =>
      checkRuntime({ cwd: args.cwd, runtimeSurface: runtimeSurface! }),
    );
  } else {
    checks.runtime_verification = skipped(
      "runtime_verification",
      hasRuntimeSurface
        ? "Skipped — existing tests already broken."
        : "No runtime surface declared.",
    );
  }

  // ── Soft, cheap, independent checks in parallel ───────────────────────
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

  // ── Critic: v2 when we have an understanding, v1 otherwise ────────────
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

  let criticV2Report: CriticV2Report | undefined;
  // Which critic actually adjudicated — read in the verdict computation so
  // a silent fall-through can't mismark `activeCritic` as a skipped stub.
  let activeCriticKey: "critic" | "critic_v2";

  // We can only run critic v2 with an understanding (it needs acceptance
  // criteria to adjudicate). If the caller asked for v2 without one, that's
  // a programming error — fall back to v1 but log it loudly so it surfaces.
  const wantV2 = args.useCriticV2 && args.understanding;
  if (args.useCriticV2 && !args.understanding) {
    log.warn(
      "verify",
      "useCriticV2=true but understanding is null — falling back to v1 critic",
    );
  }

  if (wantV2) {
    const acceptanceCode =
      args.acceptancePaths && args.acceptancePaths.length > 0
        ? await readTestCode(args.cwd, args.acceptancePaths)
        : "";
    const acceptanceDetail = checks.acceptance_tests.detail as
      | { stdoutTail?: string }
      | undefined;
    const acceptanceOutput =
      acceptanceDetail?.stdoutTail ?? checks.acceptance_tests.message;
    const runtimeDetail = checks.runtime_verification.detail;
    const runtimeJson = runtimeDetail
      ? JSON.stringify(runtimeDetail).slice(0, 4000)
      : null;

    const criticResult = await run("critic_v2", () =>
      checkCriticV2({
        issue: args.issue,
        understanding: args.understanding!,
        diffText,
        acceptanceTestCode: acceptanceCode,
        acceptanceTestOutput: acceptanceOutput,
        runtimeVerificationJson: runtimeJson,
      }),
    );
    criticV2Report = (criticResult as { report?: CriticV2Report }).report;
    // Keep the v1 slot filled so existing consumers (PR body, dashboards)
    // don't crash. Marked as skipped.
    checks.critic = skipped("critic", "Replaced by critic_v2 for this run.");
    activeCriticKey = "critic_v2";
  } else {
    checks.critic_v2 = skipped(
      "critic_v2",
      "Not requested — falling back to v1 critic.",
    );
    await run("critic", () =>
      checkCritic({
        issue: args.issue,
        plan: args.plan,
        diffText,
        newTestOutput,
      }),
    );
    activeCriticKey = "critic";
  }

  // ── Verdict ──────────────────────────────────────────────────────────
  const hardFailures = Object.values(checks).filter(
    (c) => c.hardGate && !c.pass,
  );
  const softFailures = Object.values(checks).filter(
    (c) => !c.hardGate && !c.pass,
  );

  // Pass requires no hard-gate failures + the critic that ACTUALLY ran
  // passing. Reading `checks[activeCriticKey]` instead of recomputing the
  // branch closes the silent-bypass hole (when wantV2 was true but the v2
  // critic was skipped due to infra failure, it should NOT count as pass).
  const activeCritic = checks[activeCriticKey];
  const pass = hardFailures.length === 0 && activeCritic.pass !== false;

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
    criticV2: criticV2Report,
    runtimeOk: checks.runtime_verification.pass,
  };
}
