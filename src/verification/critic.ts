import { z } from "zod";
import type { CheckResult, Plan } from "./types";
import { CRITIC_JSON_SCHEMA, criticPrompt, type IssueForPrompt } from "../claude/prompts";
import { botConfig } from "../../bot.config";
import { runClaudeHeadless } from "../claude/headless";

const ResponseSchema = z.object({
  implements_issue: z.enum(["yes", "partly", "no", "not-clear"]),
  test_depth: z.enum(["deep", "shallow", "absent"]),
  missed_edge_cases: z.array(z.string()),
  hidden_bugs: z.array(
    z.object({
      description: z.string(),
      severity: z.enum(["low", "medium", "high"]),
    }),
  ),
  merge_confidence: z.number().min(0).max(100),
  one_line_summary: z.string(),
});

export type CriticReport = z.infer<typeof ResponseSchema>;

export async function checkCritic(args: {
  issue: IssueForPrompt;
  plan: Plan;
  diffText: string;
  newTestOutput: string;
}): Promise<CheckResult & { report?: CriticReport }> {
  const userPrompt = criticPrompt(args);
  const systemAppend = `Output ONLY a single JSON object that conforms to this schema. No prose, no code fences, no explanation. Schema:
${JSON.stringify(CRITIC_JSON_SCHEMA)}`;

  const result = await runClaudeHeadless({
    prompt: userPrompt,
    systemPromptAppend: systemAppend,
    timeoutMs: botConfig.claudeCode.criticTimeoutMs,
    expectJson: true,
  });

  if (!result.ok) {
    return {
      name: "critic",
      pass: true,
      hardGate: false,
      message: `Critic skipped: ${result.error.slice(0, 200)}`,
    };
  }

  const parsed = ResponseSchema.safeParse(result.json);
  if (!parsed.success) {
    return {
      name: "critic",
      pass: false,
      hardGate: false,
      message: `Critic output schema mismatch: ${parsed.error.message}`,
    };
  }

  const report = parsed.data;
  const minConfidence = botConfig.verification.criticMinConfidence;
  const hasHighBug = report.hidden_bugs.some((b) => b.severity === "high");
  const implementsOk = report.implements_issue === "yes";
  const pass =
    report.merge_confidence >= minConfidence && !hasHighBug && implementsOk;

  return {
    name: "critic",
    pass,
    hardGate: false,
    message: `Critic: ${report.merge_confidence}/100 — ${report.one_line_summary}`,
    detail: report,
    report,
  };
}
