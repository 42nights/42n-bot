import { describe, it, expect } from "vitest";
import { renderPrBody } from "../src/coordinator/pr-body";
import type { Understanding, CriticV2Report } from "../src/claude/phases/types";

const plan = {
  files_to_change: [{ path: "src/x.ts", kind: "modify" as const, why: "" }],
  tests_to_add_or_update: [{ path: "test/x.test.ts", describes: "x" }],
  user_visible_change: "Add retry to the webhook handler on 5xx.",
  edge_cases: ["timeouts", "concurrent retries"],
  complexity: "small" as const,
  should_abort: false,
  abort_reason: null,
};

const verdict = {
  pass: true,
  attempt: 1,
  failureSummary: "",
  checks: {
    typecheck: { name: "typecheck" as const, pass: true, hardGate: true, message: "ok" },
    existing_tests: { name: "existing_tests" as const, pass: true, hardGate: true, message: "ok" },
    plan_tests_added: { name: "plan_tests_added" as const, pass: true, hardGate: true, message: "ok" },
    mutation_light: { name: "mutation_light" as const, pass: true, hardGate: true, message: "ok" },
    lint: { name: "lint" as const, pass: true, hardGate: false, message: "ok" },
    diff_size: { name: "diff_size" as const, pass: true, hardGate: false, message: "ok" },
    banned_patterns: { name: "banned_patterns" as const, pass: true, hardGate: true, message: "ok" },
    critic: {
      name: "critic" as const,
      pass: true,
      hardGate: false,
      message: "ok",
      detail: {
        merge_confidence: 87,
        one_line_summary: "Looks good, well-scoped retry.",
        missed_edge_cases: ["DNS failure mid-retry"],
      },
    },
    acceptance_tests: { name: "acceptance_tests" as const, pass: true, hardGate: true, message: "ok" },
    critic_v2: { name: "critic_v2" as const, pass: true, hardGate: false, message: "ok" },
    runtime_verification: { name: "runtime_verification" as const, pass: true, hardGate: false, message: "No runtime surface declared — skipped." },
  },
};

describe("renderPrBody", () => {
  const body = renderPrBody({
    issue: { number: 42, title: "Add retry to webhook handler", body: "Some context here." },
    plan,
    verdict,
    attempts: 1,
    runId: 142,
    costUsd: 0.31,
    needsReview: false,
  });

  it("contains the closes line", () => {
    expect(body).toContain("Closes #42");
  });
  it("contains the verification table", () => {
    expect(body).toContain("| Typecheck |");
    expect(body).toContain("✅");
  });
  it("contains the critic summary", () => {
    expect(body).toContain("87/100");
    expect(body).toContain("Looks good, well-scoped retry.");
  });
  it("includes a link to the dashboard", () => {
    // v2 overhaul: PR bodies link to /sessions/[id] now, not /runs/[id].
    expect(body).toContain("/sessions/142");
  });
  it("does NOT include the WARNING block when verification passed", () => {
    expect(body).not.toContain("[!WARNING]");
  });

  it("includes WARNING when needsReview is true", () => {
    const b = renderPrBody({
      issue: { number: 42, title: "x", body: "y" },
      plan,
      verdict: { ...verdict, pass: false },
      attempts: 3,
      runId: 142,
      costUsd: 1.4,
      needsReview: true,
    });
    expect(b).toContain("[!WARNING]");
    expect(b).toContain("3 iteration(s)");
  });
});

// Regression for PR #23: the critic adjudicated every criterion clearly_yes,
// but the table joined verdicts to criteria by EXACT text — and the critic
// paraphrases — so every row printed "Not adjudicated". The join must survive
// paraphrasing (index fallback).
describe("renderAcceptanceTable join survives critic paraphrasing", () => {
  const understanding: Understanding = {
    issue_type: "bug",
    issue_summary: "tag filter is case sensitive",
    acceptance_criteria: [
      "`pulse list --tag Work` returns tasks that were added with tag `work` (case-insensitive match)",
      "`pulse list --tag DoesNotExist` returns no tasks (negative case)",
    ],
    user_visible_outcome: "case-insensitive tag filter",
    relevant_files: [
      { path: "src/commands/list.ts", relevance: "likely_changes", why: "the filter" },
    ],
    unknowns: [],
    runtime_surface: {
      starts_dev_server: false,
      adds_or_modifies_endpoints: [],
      adds_migration: false,
      modifies_database_schema: false,
      external_dependencies: [],
    },
    confidence_to_proceed: 98,
    proceed: true,
    abort_reason: null,
  };

  const criticV2: CriticV2Report = {
    // NOTE: criterion text is deliberately PARAPHRASED vs understanding above.
    implements_acceptance_criteria: [
      {
        criterion: "list --tag Work returns tasks added with work (case-insensitive)",
        verdict: "clearly_yes",
        evidence: "normalizeTag applied to the query before includes()",
      },
      {
        criterion: "non-existent tag returns nothing",
        verdict: "clearly_yes",
        evidence: "negative test asserts empty output",
      },
    ],
    test_quality: {
      acceptance_tests_match_criteria: true,
      test_code_is_meaningful: true,
      false_positive_likely: false,
    },
    hidden_bugs: [],
    merge_confidence: 95,
    one_line_summary: "Minimal correct fix.",
  };

  const body = renderPrBody({
    issue: { number: 20, title: "tag filter case-sensitive", body: "x" },
    plan,
    verdict,
    attempts: 1,
    runId: 97,
    costUsd: 1.29,
    needsReview: false,
    understanding,
    criticV2,
  });

  it("shows the verdict glyph for every criterion despite paraphrasing", () => {
    const glyphs = body.match(/✅ Clearly yes/g) ?? [];
    expect(glyphs.length).toBe(2);
  });
  it("does NOT print 'Not adjudicated' when the critic covered every criterion", () => {
    expect(body).not.toContain("Not adjudicated");
  });
});
