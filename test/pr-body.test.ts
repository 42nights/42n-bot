import { describe, it, expect } from "vitest";
import { renderPrBody } from "../src/coordinator/pr-body";

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
    expect(body).toContain("/runs/142");
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
