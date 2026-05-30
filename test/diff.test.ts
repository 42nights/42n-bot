import { describe, it, expect } from "vitest";
import { checkDiffSize, checkPlanTestsAdded } from "../src/verification/diff";

const samplePlan = {
  files_to_change: [],
  tests_to_add_or_update: [
    { path: "test/foo.test.ts", describes: "foo" },
    { path: "test/bar.test.ts", describes: "bar" },
  ],
  user_visible_change: "x",
  edge_cases: [],
  complexity: "small" as const,
  should_abort: false,
  abort_reason: null,
};

describe("checkDiffSize", () => {
  it("passes a tiny diff", () => {
    const r = checkDiffSize("--- a\n+++ b\n@@\n+hi\n", samplePlan);
    expect(r.pass).toBe(true);
  });

  it("flags a giant diff", () => {
    const huge = Array(2000).fill("+ line").join("\n");
    const r = checkDiffSize(huge, samplePlan);
    expect(r.pass).toBe(false);
  });

  it("allows 2x cap when plan complexity is 'large'", () => {
    const huge = Array(1500).fill("+ line").join("\n");
    expect(checkDiffSize(huge, samplePlan).pass).toBe(false);
    expect(
      checkDiffSize(huge, { ...samplePlan, complexity: "large" }).pass,
    ).toBe(true);
  });
});

describe("checkPlanTestsAdded", () => {
  it("passes when all planned test files are in the diff", () => {
    const r = checkPlanTestsAdded(["src/foo.ts", "test/foo.test.ts", "test/bar.test.ts"], samplePlan);
    expect(r.pass).toBe(true);
  });

  it("passes only on exact normalized path match", () => {
    // QA1: previous behavior false-passed via suffix match — a test at
    // packages/x/test/bar.test.ts was accepted when the plan declared
    // test/bar.test.ts. Now we require exact match (after stripping a
    // leading "./") so a test in the wrong directory fails this check.
    const r = checkPlanTestsAdded(
      ["src/foo.ts", "./test/foo.test.ts", "test/bar.test.ts"],
      samplePlan,
    );
    expect(r.pass).toBe(true);
  });

  it("fails when a planned test lives at a different path (no suffix false-pass)", () => {
    const r = checkPlanTestsAdded(
      ["src/foo.ts", "test/foo.test.ts", "packages/x/test/bar.test.ts"],
      samplePlan,
    );
    expect(r.pass).toBe(false);
  });

  it("fails when planned test file is missing", () => {
    const r = checkPlanTestsAdded(["src/foo.ts"], samplePlan);
    expect(r.pass).toBe(false);
  });

  it("passes when plan declared no tests", () => {
    const r = checkPlanTestsAdded(
      [],
      { ...samplePlan, tests_to_add_or_update: [] },
    );
    expect(r.pass).toBe(true);
  });
});
