import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import type { CheckResult, Plan } from "./types";
import { CRITIC_JSON_SCHEMA, criticPrompt, type IssueForPrompt } from "../claude/prompts";
import { botConfig } from "../../bot.config";

const CRITIC_MODEL = "claude-haiku-4-5-20251001";

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

let _client: Anthropic | null = null;
function client(): Anthropic {
  if (!_client) {
    _client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY ?? "" });
  }
  return _client;
}

export async function checkCritic(args: {
  issue: IssueForPrompt;
  plan: Plan;
  diffText: string;
  newTestOutput: string;
}): Promise<CheckResult & { report?: CriticReport }> {
  if (!process.env.ANTHROPIC_API_KEY) {
    return {
      name: "critic",
      pass: true,
      hardGate: false,
      message: "ANTHROPIC_API_KEY missing — critic skipped.",
    };
  }
  const prompt = criticPrompt(args);
  const response = await client().messages.create({
    model: CRITIC_MODEL,
    max_tokens: 1500,
    tool_choice: { type: "tool", name: "submit_review" },
    tools: [
      {
        name: "submit_review",
        description: "Submit the structured critic review.",
        input_schema: CRITIC_JSON_SCHEMA as any,
      },
    ],
    messages: [{ role: "user", content: prompt }],
  });
  const tool = response.content.find((b) => b.type === "tool_use") as
    | { type: "tool_use"; input: unknown }
    | undefined;
  if (!tool) {
    return {
      name: "critic",
      pass: false,
      hardGate: false,
      message: "Critic returned no tool call.",
    };
  }
  const parsed = ResponseSchema.safeParse(tool.input);
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
  const pass = report.merge_confidence >= minConfidence && !hasHighBug && implementsOk;
  return {
    name: "critic",
    pass,
    hardGate: false,
    message: pass
      ? `Critic: ${report.merge_confidence}/100 — ${report.one_line_summary}`
      : `Critic: ${report.merge_confidence}/100 — ${report.one_line_summary}`,
    detail: report,
    report,
  };
}
