import { describe, it, expect } from "vitest";
import { checkBannedPatterns } from "../src/verification/banned";

const diffFor = (added: string[]) =>
  ["--- a/x.ts", "+++ b/x.ts", "@@ -1,1 +1,1 @@", ...added.map((l) => `+${l}`)].join("\n");

describe("banned patterns", () => {
  it("passes a clean diff", () => {
    const r = checkBannedPatterns(diffFor(["const x = 1;", "function foo() {}"]));
    expect(r.pass).toBe(true);
  });

  it("catches @ts-ignore", () => {
    const r = checkBannedPatterns(diffFor(["// @ts-ignore weird type", "const y: any = z;"]));
    expect(r.pass).toBe(false);
  });

  it("catches eslint-disable-next-line", () => {
    const r = checkBannedPatterns(diffFor(["// eslint-disable-next-line", "let v = 0;"]));
    expect(r.pass).toBe(false);
  });

  it("catches it.skip and xit", () => {
    expect(checkBannedPatterns(diffFor(["  it.skip('broken', () => {})"])).pass).toBe(false);
    expect(checkBannedPatterns(diffFor(["  xit('also broken', () => {})"])).pass).toBe(false);
    expect(checkBannedPatterns(diffFor(["  describe.skip('whole module', () => {})"])).pass).toBe(false);
  });

  it("ignores patterns on context lines (only checks `+` adds)", () => {
    // Context line that contains @ts-ignore but isn't a `+` addition.
    const diff = [
      "--- a/x.ts",
      "+++ b/x.ts",
      "@@ -1,2 +1,2 @@",
      " // @ts-ignore old comment",   // context
      "+const x = 1;",
    ].join("\n");
    expect(checkBannedPatterns(diff).pass).toBe(true);
  });
});
