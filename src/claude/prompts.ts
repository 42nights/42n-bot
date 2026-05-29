// All prompts the bot sends to Claude Code, in one place. Versioned because
// the verification harness depends on the implementer's output shape.
export const PROMPT_VERSION = "v1";

export type IssueForPrompt = {
  number: number;
  title: string;
  body: string;
  labels: string[];
};

export const PLAN_JSON_SCHEMA = {
  $schema: "http://json-schema.org/draft-07/schema#",
  type: "object",
  properties: {
    files_to_change: {
      type: "array",
      items: {
        type: "object",
        properties: {
          path: { type: "string" },
          kind: { type: "string", enum: ["modify", "create", "delete"] },
          why: { type: "string" },
        },
        required: ["path", "kind", "why"],
      },
    },
    tests_to_add_or_update: {
      type: "array",
      items: {
        type: "object",
        properties: {
          path: { type: "string" },
          describes: { type: "string" },
        },
        required: ["path", "describes"],
      },
    },
    user_visible_change: { type: "string" },
    edge_cases: { type: "array", items: { type: "string" } },
    complexity: {
      type: "string",
      enum: ["trivial", "small", "medium", "large"],
    },
    should_abort: { type: "boolean" },
    abort_reason: { type: ["string", "null"] },
  },
  required: [
    "files_to_change",
    "tests_to_add_or_update",
    "user_visible_change",
    "edge_cases",
    "complexity",
    "should_abort",
    "abort_reason",
  ],
} as const;

export function planPrompt(issue: IssueForPrompt, repoSummary: string): string {
  return `You are planning an implementation for the following issue. Do NOT write any code yet.

Issue #${issue.number}: ${issue.title}

${issue.body}

Repo layout:
${repoSummary}

Your task:
1. Identify which files need to change.
2. Identify what tests need to exist after this change.
3. Describe the user-visible behavior change in one sentence.
4. Identify any risks or edge cases.
5. Estimate complexity: trivial / small / medium / large.

Set should_abort=true if the issue is unclear, requires architectural changes
too large for a bot, or asks for something dangerous (e.g., disabling tests).
Explain in abort_reason.`;
}

export function implementPrompt(
  issue: IssueForPrompt,
  plan: unknown,
): string {
  return `You are implementing the plan below in the current working directory.

Plan:
${JSON.stringify(plan, null, 2)}

Issue body for reference:
${issue.body}

Rules:
- Only modify files listed in files_to_change.
- Add/update the tests listed in tests_to_add_or_update.
- Write tests that actually exercise the change. A test that doesn't fail
  when the implementation is broken is worse than no test.
- Run the tests yourself before claiming you're done.
- If you discover the plan was wrong, stop and report it; don't improvise.

When you finish, end with a short JSON status block in a fenced code block:

\`\`\`json
{
  "completed": true,
  "files_changed": ["..."],
  "test_command_run": "...",
  "test_output_excerpt": "...",
  "self_assessment": "..."
}
\`\`\`
`;
}

export function iterationPrompt(verdictJson: string, planJson: string): string {
  return `Your previous implementation did not pass verification. Here is the verdict:
${verdictJson}

Original plan:
${planJson}

Fix the problems in the verdict. Stay within the plan scope. Do not introduce
new behavior beyond what's needed to make the verdict pass.

If you believe the verdict is wrong, you can argue why. But do not bypass the
verdict — the verdict's tests are authoritative.`;
}

export const CRITIC_JSON_SCHEMA = {
  $schema: "http://json-schema.org/draft-07/schema#",
  type: "object",
  properties: {
    implements_issue: {
      type: "string",
      enum: ["yes", "partly", "no", "not-clear"],
    },
    test_depth: {
      type: "string",
      enum: ["deep", "shallow", "absent"],
    },
    missed_edge_cases: { type: "array", items: { type: "string" } },
    hidden_bugs: {
      type: "array",
      items: {
        type: "object",
        properties: {
          description: { type: "string" },
          severity: { type: "string", enum: ["low", "medium", "high"] },
        },
        required: ["description", "severity"],
      },
    },
    merge_confidence: { type: "number", minimum: 0, maximum: 100 },
    one_line_summary: { type: "string" },
  },
  required: [
    "implements_issue",
    "test_depth",
    "missed_edge_cases",
    "hidden_bugs",
    "merge_confidence",
    "one_line_summary",
  ],
} as const;

export function criticPrompt(args: {
  issue: IssueForPrompt;
  plan: unknown;
  diffText: string;
  newTestOutput: string;
}): string {
  return `You are reviewing a code change. You have no skin in the game. Be skeptical.

Issue #${args.issue.number}: ${args.issue.title}
${args.issue.body}

Plan that was approved:
${JSON.stringify(args.plan, null, 2)}

Diff:
${args.diffText}

New test output:
${args.newTestOutput}

Answer ALL of the following:
1. Does the diff actually implement what the issue asked for? (yes / partly / no / not-clear)
2. Are the new tests testing the actual change, or are they shallow? (deep / shallow / absent)
3. Are there obvious edge cases the diff misses? List them.
4. Is there any code that LOOKS like it works but is actually broken? (e.g., async bug, off-by-one, wrong default value)
5. Confidence this should be merged as-is (0-100).`;
}

export const REVIEW_JSON_SCHEMA = {
  $schema: "http://json-schema.org/draft-07/schema#",
  type: "object",
  properties: {
    candidates: {
      type: "array",
      maxItems: 5,
      items: {
        type: "object",
        properties: {
          type: {
            type: "string",
            enum: [
              "bug",
              "missing-test",
              "code-smell",
              "missing-doc",
              "security",
              "performance",
              "accessibility",
            ],
          },
          title: { type: "string" },
          files: { type: "array", items: { type: "string" } },
          lines: { type: "array", items: { type: "string" } },
          why_matters: { type: "string" },
          suggested_fix: { type: "string" },
          severity: { type: "string", enum: ["low", "medium", "high"] },
        },
        required: ["type", "title", "files", "why_matters", "suggested_fix", "severity"],
      },
    },
  },
  required: ["candidates"],
} as const;

export const REVIEW_PROMPT = `You are reviewing this codebase as if you were a senior engineer joining the team.

Find up to 5 specific things that should be GitHub issues. For each, identify:
- Type: bug | missing-test | code-smell | missing-doc | security | performance | accessibility
- File(s) affected
- Specific line numbers if obvious
- Why it matters (one sentence)
- Suggested fix in one sentence
- Severity: low | medium | high

Do NOT propose:
- Subjective style preferences ("I'd rename this variable")
- Refactors with no concrete benefit
- Things already in TODOs / FIXMEs in the code (those have a reason)`;
