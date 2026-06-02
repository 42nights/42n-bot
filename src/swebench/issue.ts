import type { SwebenchInstance } from "./types";
import type { IssueForPrompt } from "../claude/prompts";

/**
 * Stable synthetic issue number from instance_id. We hash the string to a
 * positive int so the number is deterministic and unique-ish per instance.
 * The exact value doesn't matter — it's only used for FK rows in `runs`.
 */
function syntheticIssueNumber(instanceId: string): number {
  let h = 0;
  for (let i = 0; i < instanceId.length; i++) {
    h = ((h << 5) - h + instanceId.charCodeAt(i)) | 0;
  }
  return Math.abs(h) || 1;
}

/**
 * Build an IssueForPrompt from a SWE-bench instance. The agent only ever sees
 * this — patch/test_patch are never included.
 *
 * hints_text is EXCLUDED by default: the standard SWE-bench task input (and
 * every lab leaderboard number) is problem_statement only, and the pre-PR
 * comment thread frequently leaks the actual fix. Pass includeHints=true
 * (harness flag --hints) only for a deliberately non-comparable run.
 */
export function instanceToIssue(
  inst: SwebenchInstance,
  includeHints = false,
): IssueForPrompt {
  const lines = inst.problem_statement.split("\n");
  const title = lines.find((l) => l.trim().length > 0)?.trim() ?? inst.instance_id;

  let body = inst.problem_statement;
  if (includeHints && inst.hints_text && inst.hints_text.trim().length > 0) {
    body += `\n\n--- Hints ---\n\`\`\`\n${inst.hints_text.trim()}\n\`\`\``;
  }

  return {
    number: syntheticIssueNumber(inst.instance_id),
    title,
    body,
    labels: [],
  };
}
