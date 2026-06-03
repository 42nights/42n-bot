/**
 * The narration translation layer — turns raw event-log rows into Otis's
 * voice.
 *
 * Spec contract from §6 of the redesign doc:
 *  - Pure function. No side effects, no state. Coalescing happens upstream.
 *  - Returns NarrationLine | null. Null = event has no human-facing narration.
 *  - "thinking: true" means render the pulsing cursor at the end of this line.
 *
 * Voice rules:
 *  - Terse. One sentence per line where possible.
 *  - Backticks around filenames, code, commands.
 *  - No emoji. No exclamation points. No "I'll do my best".
 *  - Don't narrate successful verification checks (too noisy).
 */

export type NarrationLine =
  | { kind: "agent"; text: string; thinking?: boolean }
  | { kind: "system"; text: string; status?: "ok" | "warn" | "fail" }
  | { kind: "user"; text: string };

export type TranslateContext = {
  issueNumber: number | null;
  issueTitle: string | null;
  repo: string;
  runType: "implement" | "review" | "system";
};

export type EventRow = {
  id: string;
  ts: number;
  kind: string;
  payload_json: string;
};

function safeJson(s: string): Record<string, unknown> {
  try {
    return JSON.parse(s) as Record<string, unknown>;
  } catch {
    return {};
  }
}

function basename(p: string | undefined): string {
  if (!p) return "";
  return p.replace(/^.*\//, "");
}

function pluralize(n: number): string {
  return n === 1 ? "" : "s";
}

function capitalize(s: string): string {
  return s.length === 0 ? s : s[0].toUpperCase() + s.slice(1);
}

export function translate(
  event: EventRow,
  ctx: TranslateContext,
): NarrationLine | null {
  const p = safeJson(event.payload_json);
  switch (event.kind) {
    case "run.created":
      if (ctx.runType === "review") {
        return {
          kind: "system",
          text: `Otis started a review pass on ${ctx.repo}.`,
        };
      }
      return {
        kind: "system",
        text: ctx.issueTitle
          ? `Otis picked up #${ctx.issueNumber}: "${ctx.issueTitle}".`
          : `Otis picked up a new task on ${ctx.repo}.`,
      };

    case "plan.started":
      return {
        kind: "agent",
        text: "Reading the codebase to plan…",
        thinking: true,
      };

    case "plan.completed": {
      const plan = (p.plan ?? p) as Record<string, unknown>;
      const files = Array.isArray(plan.files_to_change)
        ? plan.files_to_change.length
        : 0;
      const tests = Array.isArray(plan.tests_to_add_or_update)
        ? plan.tests_to_add_or_update.length
        : 0;
      const complexity = (plan.complexity as string | undefined) ?? "medium";
      return {
        kind: "agent",
        text:
          `Plan ready. ${files} file${pluralize(files)} to change, ` +
          `${tests} test${pluralize(tests)} to add. ` +
          `Complexity: ${complexity}.`,
      };
    }

    case "plan.aborted":
      return {
        kind: "system",
        status: "warn",
        text: `Otis chose not to implement this. Reason: ${(p.reason as string) ?? "scope unclear"}.`,
      };

    case "implement.started":
      return {
        kind: "agent",
        text: "Starting the implementation.",
        thinking: true,
      };

    case "implement.tool_use": {
      const tool = (p.name as string | undefined) ?? (p.tool as string | undefined) ?? "tool";
      const input = (p.input as Record<string, unknown> | undefined) ?? {};
      const file = basename(
        (input.file_path as string | undefined) ?? (input.path as string | undefined),
      );
      if (tool === "Read") return { kind: "agent", text: `Reading \`${file}\`.` };
      if (tool === "Edit") return { kind: "agent", text: `Editing \`${file}\`.` };
      if (tool === "Write") return { kind: "agent", text: `Writing \`${file}\`.` };
      if (tool === "MultiEdit")
        return { kind: "agent", text: `Editing \`${file}\` (multi-edit).` };
      if (tool === "Bash") {
        const cmd = ((input.command as string | undefined) ?? "").slice(0, 80);
        return { kind: "agent", text: `Running \`${cmd}\`.` };
      }
      if (tool === "Glob") return { kind: "agent", text: "Searching the codebase." };
      if (tool === "Grep") {
        const pat = ((input.pattern as string | undefined) ?? "").slice(0, 60);
        return { kind: "agent", text: `Looking for \`${pat}\`.` };
      }
      return { kind: "agent", text: `Using ${tool}.` };
    }

    case "implement.completed":
      return {
        kind: "agent",
        text: "Implementation done. Running verification.",
      };

    case "implement.failed": {
      const why = (p.kind as string | undefined) ?? (p.errorKind as string | undefined) ?? "unknown";
      const map: Record<string, string> = {
        timeout: "Hit the time budget. Stopping.",
        hang_no_event: "Subprocess went quiet. Stopping.",
        hang_no_tool_use: "Lost the thread. Stopping.",
        budget_exceeded: "Hit the cost budget. Stopping.",
        api_retry_storm: "The API kept retrying. Stopping.",
        spawn_failed: "Couldn't start the Claude subprocess. Stopping.",
        schema_violation: "Output didn't match the expected schema. Stopping.",
        non_zero_exit: "Subprocess exited with an error. Stopping.",
      };
      return {
        kind: "system",
        status: "fail",
        text: map[why] ?? `Implementation stopped: ${why}.`,
      };
    }

    case "verification.started":
      return {
        kind: "agent",
        text: "Running the verification harness.",
        thinking: true,
      };

    case "verification.check_started": {
      const check =
        (p.check as string | undefined) ?? (p.name as string | undefined) ?? "?";
      const label: Record<string, string> = {
        typecheck: "Type-checking",
        existing_tests: "Running the existing tests",
        plan_tests_added: "Checking I added the planned tests",
        mutation_light: "Verifying the new tests actually catch the change",
        lint: "Linting",
        diff_size: "Checking the diff size",
        banned_patterns: "Checking for banned patterns",
        critic: "Asking a second-pair reviewer",
      };
      return {
        kind: "agent",
        text: `${label[check] ?? capitalize(check)}…`,
        thinking: true,
      };
    }

    case "verification.check_completed": {
      const ok =
        p.pass === true || (typeof p.pass === "number" && p.pass === 1);
      const check =
        (p.check as string | undefined) ?? (p.name as string | undefined) ?? "?";
      const msg = (p.message as string | undefined) ?? "";
      if (ok) return null; // skip noise — only narrate failures
      return {
        kind: "system",
        status: "warn",
        text: `${capitalize(check)} failed: ${msg}`,
      };
    }

    case "verification.completed": {
      const ok = p.pass === true;
      if (ok) return { kind: "agent", text: "All checks passed." };
      const hard = (p.hardFailures as number | undefined) ?? 0;
      return {
        kind: "agent",
        text:
          hard > 0
            ? `${hard} hard check${pluralize(hard)} failed. I'll iterate.`
            : "Soft checks flagged something. Reviewing.",
      };
    }

    case "iteration.started":
      return {
        kind: "agent",
        text: `Attempt ${p.attempt ?? "?"}: addressing the verification feedback.`,
        thinking: true,
      };

    case "pr.opened":
      return {
        kind: "system",
        status: "ok",
        text: `Opened PR #${p.number ?? "?"}.`,
      };

    case "pr.needs_review":
      return {
        kind: "system",
        status: "warn",
        text: `PR #${p.number ?? "?"} opened, but the verification harness wasn't fully satisfied. Needs your eyes.`,
      };

    case "pr.failed":
      return {
        kind: "system",
        status: "fail",
        text: `Couldn't open the PR: ${(p.error as string | undefined) ?? "unknown error"}.`,
      };

    case "pr.merged":
      return {
        kind: "system",
        status: "ok",
        text: `PR #${p.number ?? "?"} merged.`,
      };

    case "review.started":
      return {
        kind: "agent",
        text: `Scanning ${ctx.repo} for things worth filing.`,
        thinking: true,
      };

    case "review.proposed":
      return {
        kind: "agent",
        text: `Proposed ${p.count ?? "?"} candidate issues.`,
      };

    case "review.opened_issue":
      return {
        kind: "system",
        status: "ok",
        text: `Filed issue #${p.number ?? "?"}: ${(p.title as string | undefined) ?? ""}.`,
      };

    case "review.deduped":
      return {
        kind: "system",
        text: `Skipped one — looks like a duplicate of #${p.nearest ?? "?"}.`,
      };

    case "claude.budget_exceeded":
      return {
        kind: "system",
        status: "fail",
        text: "Cost budget exceeded — stopping the run.",
      };

    case "run.finished":
    case "run.status":
    case "claude.subprocess.spawned":
    case "claude.subprocess.exit":
    case "log":
      return null;

    default:
      return null;
  }
}

/**
 * Coalesce adjacent same-kind narration lines that read awkwardly when
 * repeated. Currently: collapse consecutive "Reading `X`" / "Editing `X`"
 * lines that touch the same file within 8 seconds. Returns a new list.
 */
export function coalesceNarration(
  lines: Array<NarrationLine & { id: string; ts: number }>,
): Array<NarrationLine & { id: string; ts: number }> {
  const out: typeof lines = [];
  for (const cur of lines) {
    const prev = out[out.length - 1];
    if (
      prev &&
      cur.kind === "agent" &&
      prev.kind === "agent" &&
      cur.text === prev.text &&
      Math.abs(cur.ts - prev.ts) < 8_000
    ) {
      // Collapse — bump the timestamp on the previous line so the UI shows
      // the latest one, but don't add a new bubble.
      prev.ts = cur.ts;
      prev.id = cur.id;
      continue;
    }
    out.push({ ...cur });
  }
  return out;
}
