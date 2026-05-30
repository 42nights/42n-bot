import { runCmd } from "./run";
import type { CheckResult, Plan } from "./types";
import type { ToolchainHints } from "./detect";

/**
 * Mutation-light: prove the new tests are doing something by running them
 * against the PRE-change baseline (should fail — the new behavior isn't there
 * yet) and the POST-change tree (should pass).
 *
 * Strategy:
 *  1. `git stash push --include-untracked` to set aside the impl.
 *  2. Restore only the new test files from the stash.
 *  3. Run the tests — they SHOULD fail.
 *  4. `git stash pop` to restore everything.
 *  5. Run again — they SHOULD pass.
 *
 * B3: When the toolchain supports targeted file runs (vitest/jest/pytest/go),
 * we pass just the new test files instead of the whole suite. Halves runtime
 * on most repos. Falls back to whole-suite for runners that don't.
 *
 * A6: If `git stash pop` fails, returns `pass:false` with `broken:true` on
 * detail. The implementer treats `broken` as an immediate run-failure (no
 * point iterating in a corrupted worktree).
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

  // B3: prefer targeted runs when the runner supports it.
  const cmd = hints.testFilesArgv ? hints.testFilesArgv(testFiles) : hints.test;

  // Clear any intent-to-add markers (`git add -N`) left on new files by the
  // diff-capture step earlier in the pipeline. `git stash --include-untracked`
  // aborts with "Entry '<file>' not uptodate. Cannot merge." on a -N entry
  // (an empty index blob that mismatches the real worktree content). A mixed
  // reset unstages those markers; the working-tree changes (modified impl,
  // untracked tests) are untouched, so the stash below captures them correctly.
  await runCmd(["git", "reset", "-q"], cwd);

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

  // QA3 (R3 finding 4): a failed `git checkout stash@{0} -- <file>` (e.g. the
  // test file doesn't exist in the stash because it was deleted in the diff)
  // used to be ignored — runCmd never throws and the exit code went
  // unchecked. We then ran the pre-tests against a corrupted tree and
  // produced meaningless results. Restore the stash and hard-fail if any
  // checkout fails.
  for (const t of testFiles) {
    const restore = await runCmd(["git", "checkout", "stash@{0}", "--", t], cwd);
    if (restore.exitCode !== 0) {
      // Try to pop the stash so we leave the tree as we found it.
      const pop = await runCmd(["git", "stash", "pop"], cwd);
      // QA4: if the recovery pop ALSO fails, the worktree is now inconsistent
      // (the implementer's changes are stuck in the stash). Signal
      // `broken: true` so the implementer aborts instead of iterating in a
      // corrupted tree — same contract as the stash-pop path below.
      const broken = pop.exitCode !== 0;
      return {
        name: "mutation_light",
        pass: false,
        hardGate: true,
        message: broken
          ? `Could not restore test file "${t}" AND the stash recovery pop failed — worktree is in an inconsistent state. Aborting.`
          : `Could not restore test file "${t}" from stash for the mutation check (it may have been deleted in the diff).`,
        detail: {
          restoreStderr: restore.stderr,
          ...(broken ? { popStderr: pop.stderr, broken: true } : {}),
        },
      };
    }
  }
  const pre = await runCmd(cmd, cwd, 600_000);

  const pop = await runCmd(["git", "stash", "pop"], cwd);
  if (pop.exitCode !== 0) {
    return {
      name: "mutation_light",
      pass: false,
      hardGate: true,
      message:
        "Stash pop failed — worktree may be in an inconsistent state. Aborting.",
      // A6: signal the implementer that the tree is unrecoverable.
      detail: { popStderr: pop.stderr, broken: true },
    };
  }

  const post = await runCmd(cmd, cwd, 600_000);

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
      targeted: Boolean(hints.testFilesArgv),
    },
  };
}
