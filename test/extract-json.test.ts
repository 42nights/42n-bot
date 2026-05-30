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
});
