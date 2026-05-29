import { runCmd } from "./run";
import type { CheckResult, Plan } from "./types";
import type { ToolchainHints } from "./detect";

/**
 * Mutation-light: prove the new tests are doing something by running them
 * against the PRE-change baseline (where they should fail because the new
 * behavior isn't there yet) and the POST-change tree (where they should pass).
 *
 * Strategy:
 *  1. `git stash --keep-index --include-untracked` to set aside the impl.
 *  2. Restore only the new test files from the stash.
 *  3. Run the test suite — they SHOULD fail.
 *  4. `git stash pop` to restore everything.
 *  5. Run again — they SHOULD pass.
 *
 * For correctness across language stacks we run the whole test command both
 * times rather than trying to scope to just the new tests. Slower but
 * universally correct.
 */
export async function checkMutationLight(
  cwd: string,
  plan: Plan,
  hints: ToolchainHints,
): Promise<CheckResult> {
  if (!hints.test) {
    return {
      name: "mutation_light",
      pass: true,
      hardGate: true,
      message: "No test command — mutation-light skipped.",
    };
  }
  const testFiles = plan.tests_to_add_or_update.map((t) => t.path);
  if (!testFiles.length) {
    return {
      name: "mutation_light",
      pass: true,
      hardGate: true,
      message: "Plan declared no test files — mutation-light skipped.",
    };
  }

  // Stash everything, but keep the worktree clean — including untracked.
  const stash = await runCmd(
    ["git", "stash", "push", "--include-untracked", "-m", "42n-bot-mutation"],
    cwd,
  );
  if (stash.exitCode !== 0) {
    return {
      name: "mutation_light",
      pass: false,
      hardGate: true,
      message: "Could not stash worktree for mutation check.",
      detail: { stashStderr: stash.stderr },
    };
  }

  // Restore ONLY the new test files from the stash.
  for (const t of testFiles) {
    await runCmd(["git", "checkout", "stash@{0}", "--", t], cwd);
  }
  // Pre: tests against baseline impl should fail.
  const pre = await runCmd(hints.test, cwd, 600_000);

  // Restore the rest.
  const pop = await runCmd(["git", "stash", "pop"], cwd);
  if (pop.exitCode !== 0) {
    return {
      name: "mutation_light",
      pass: false,
      hardGate: true,
      message:
        "Stash pop failed — worktree may be in an inconsistent state. Aborting.",
      detail: { popStderr: pop.stderr },
    };
  }

  // Post: tests against the impl should pass.
  const post = await runCmd(hints.test, cwd, 600_000);

  // Pre must fail (exit != 0); post must pass (exit 0).
  const preFailed = pre.exitCode !== 0;
  const postPassed = post.exitCode === 0;
  const pass = preFailed && postPassed;
  return {
    name: "mutation_light",
    pass,
    hardGate: true,
    message: pass
      ? "Mutation-light passed: new tests fail without impl, pass with it."
      : preFailed
        ? "Mutation-light: impl-on tests still failing."
        : "Mutation-light: new tests pass even without the impl — they're not exercising the change.",
    detail: {
      pre: { exit: pre.exitCode, tail: pre.stdout.slice(-1500) },
      post: { exit: post.exitCode, tail: post.stdout.slice(-1500) },
    },
  };
}
