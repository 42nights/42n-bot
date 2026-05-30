import type { CheckResult } from "./types";
import { CriticV2Schema, type CriticV2Report } from "../claude/phases/types";
import { criticV2Prompt, type IssueForPrompt, type UnderstandingForPrompt } from "../claude/prompts";
import { runClaudeHeadless } from "../claude/headless";
import { botConfig } from "../../bot.config";

export async function checkCriticV2(args: {
  issue: IssueForPrompt;
  understanding: UnderstandingForPrompt;
  diffText: string;
  acceptanceTestCode: string;
  acceptanceTestOutput: string;
  runtimeVerificationJson: string | null;
}): Promise<CheckResult & { report?: CriticV2Report }> {
  try {
    const result = await runClaudeHeadless({
      prompt: criticV2Prompt(args),
      systemPromptAppend: "Output ONLY the JSON schema. No prose, no fences.",
      expectJson: true,
      timeoutMs: botConfig.claudeCode.criticTimeoutMs,
    });

    if (!result.ok) {
      // QA1: a critic-infrastructure failure (CLI timeout, API down) used to
      // silently pass. That meant a flaky network let every run ship without
      // adjudication. Now we return pass=false (soft gate) so the verdict
      // routes to needs-review with an explicit "critic was unreachable" tag.
      return {
        name: "critic_v2",
        pass: false,
        hardGate: false,
        message: `Critic v2 unreachable: ${result.error.slice(0, 200)} — routing to needs-review.`,
      };
    }

    const parsed = CriticV2Schema.safeParse(result.json);
    if (!parsed.success) {
      return {
        name: "critic_v2",
        pass: false,
        hardGate: false,
        message: `Schema mismatch: ${parsed.error.message.slice(0, 300)}`,
      };
    }

    const report = parsed.data;

    const minVerdict = botConfig.verification.criticV2MinPerCriterionVerdict;
    const verdictOk = (v: string): boolean =>
      minVerdict === "probably_yes"
        ? v === "clearly_yes" || v === "probably_yes"
        : v === "clearly_yes";

    const allCriteriaOk = report.implements_acceptance_criteria.every((c) =>
      verdictOk(c.verdict),
    );
    const hasHighBug = report.hidden_bugs.some((b) => b.severity === "high");
    const pass =
      report.merge_confidence >= botConfig.verification.criticMinConfidence &&
      report.test_quality.acceptance_tests_match_criteria &&
      !report.test_quality.false_positive_likely &&
      allCriteriaOk &&
      !hasHighBug;

    return {
      name: "critic_v2",
      pass,
      hardGate: false,
      message: `Critic v2: ${report.merge_confidence}/100 — ${report.one_line_summary}`,
      detail: report,
      report,
    };
  } catch (err) {
    // QA2: this catch previously returned pass:true, which silently bypassed
    // adjudication on any unexpected throw (Zod parse error, undefined
    // botConfig field, etc.) — the same shape of silent-bypass we closed in
    // Round 1's infra-failure path. Treat all exceptions as the same:
    // route to needs-review with the error in the message.
    return {
      name: "critic_v2",
      pass: false,
      hardGate: false,
      message: `Critic v2 errored: ${err instanceof Error ? err.message : String(err)} — routing to needs-review.`,
    };
  }
}
