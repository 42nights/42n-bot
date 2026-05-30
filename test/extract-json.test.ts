import { describe, it, expect } from "vitest";
import { extractJson } from "../src/claude/headless";

describe("extractJson", () => {
  it("parses a bare JSON object", () => {
    expect(extractJson('{"a":1}')).toEqual({ a: 1 });
  });

  it("parses a bare JSON array", () => {
    expect(extractJson("[1,2,3]")).toEqual([1, 2, 3]);
  });

  it("strips a ```json fenced block", () => {
    expect(extractJson('```json\n{"a":1}\n```')).toEqual({ a: 1 });
  });

  it("strips an unlabeled triple-fence block", () => {
    expect(extractJson("```\n[1,2]\n```")).toEqual([1, 2]);
  });

  it("tolerates a prose preamble", () => {
    expect(extractJson('Here is the JSON you asked for:\n\n{"ok":true}')).toEqual(
      { ok: true },
    );
  });

  it("tolerates a prose postamble", () => {
    expect(extractJson('{"ok":true}\n\nLet me know if you need anything else.')).toEqual(
      { ok: true },
    );
  });

  it("handles nested objects and balanced braces inside strings", () => {
    expect(
      extractJson('{"nested":{"x":"hi {there}"}, "ok":1}'),
    ).toEqual({ nested: { x: "hi {there}" }, ok: 1 });
  });

  it("handles escaped quotes inside strings", () => {
    expect(extractJson('{"q":"she said \\"hi\\""}')).toEqual({
      q: 'she said "hi"',
    });
  });

  it("returns undefined when there is no JSON", () => {
    expect(extractJson("nothing here")).toBeUndefined();
  });

  it("returns undefined when JSON is unbalanced", () => {
    expect(extractJson("{not closed")).toBeUndefined();
  });

  // QA3 (R3 finding 12) regressions:
  it("prefers the FIRST valid JSON over a later fenced block", () => {
    expect(
      extractJson('{"correct":1}\n```\nContains {"fake":2}\n```'),
    ).toEqual({ correct: 1 });
  });

  it("skips prose containing brace-placeholders and finds the real JSON", () => {
    expect(
      extractJson('Use the `{placeholder}` syntax. Then: {"real":true}'),
    ).toEqual({ real: true });
  });

  it("still finds JSON inside a fence when there is no bare JSON first", () => {
    expect(extractJson('Here:\n```json\n{"v":5}\n```')).toEqual({ v: 5 });
  });

  // QA4: O(n²) DoS guard — thousands of unbalanced openers before real JSON
  // must not hang. Should complete near-instantly (budget-bounded).
  it("does not hang on pathological unbalanced-brace input", () => {
    const evil = "{ ".repeat(50_000) + '[{"valid":1}]';
    const start = Date.now();
    const result = extractJson(evil);
    const elapsed = Date.now() - start;
    expect(elapsed).toBeLessThan(500); // bounded, not O(n²)
    // It may return undefined (budget exhausted) or the valid array — either
    // is acceptable; the contract is "doesn't hang".
    expect(result === undefined || Array.isArray(result)).toBe(true);
  });

  it("still finds valid JSON quickly when it is early in a large string", () => {
    const s = '{"early":true}' + "x".repeat(500_000);
    expect(extractJson(s)).toEqual({ early: true });
  });

  // QA5: legitimate large output — many balanced code-example braces (prose)
  // BEFORE the real JSON. The O(n) single-pass must still find it; the prior
  // budget-bounded O(n²) version could starve out a real JSON here.
  it("finds real JSON after thousands of balanced code-example braces", () => {
    const codeBlocks = "function f() { return { a: 1 }; }\n".repeat(5000);
    const s = codeBlocks + '{"the":"real","plan":true}';
    const t0 = Date.now();
    const r = extractJson(s);
    expect(Date.now() - t0).toBeLessThan(500);
    expect(r).toEqual({ the: "real", plan: true });
  });
});
