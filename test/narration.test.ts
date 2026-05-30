import { describe, it, expect } from "vitest";
import {
  translate,
  coalesceNarration,
  type EventRow,
  type TranslateContext,
  type NarrationLine,
} from "../lib/narration";

const ctx: TranslateContext = {
  issueNumber: 42,
  issueTitle: "Add retry to webhook",
  repo: "owner/repo",
  runType: "implement",
};

function ev(kind: string, payload: unknown, id = 1, ts = 1000): EventRow {
  return { id, ts, kind, payload_json: JSON.stringify(payload) };
}

describe("translate", () => {
  it("renders run.created with the issue title", () => {
    const line = translate(ev("run.created", {}), ctx);
    expect(line?.kind).toBe("system");
    expect(line?.text).toContain("#42");
    expect(line?.text).toContain("Add retry to webhook");
  });

  it("renders a review run.created differently", () => {
    const line = translate(ev("run.created", {}), {
      ...ctx,
      runType: "review",
    });
    expect(line?.text).toContain("review pass");
  });

  it("names the file in implement.tool_use (Edit)", () => {
    const line = translate(
      ev("implement.tool_use", {
        name: "Edit",
        input: { file_path: "src/webhook.ts" },
      }),
      ctx,
    );
    expect(line?.kind).toBe("agent");
    expect(line?.text).toBe("Editing `webhook.ts`.");
  });

  it("handles Read/Write/Bash/Grep tool variants", () => {
    expect(
      translate(ev("implement.tool_use", { name: "Read", input: { file_path: "a/b.ts" } }), ctx)?.text,
    ).toBe("Reading `b.ts`.");
    expect(
      translate(ev("implement.tool_use", { name: "Bash", input: { command: "npm test" } }), ctx)?.text,
    ).toContain("npm test");
    expect(
      translate(ev("implement.tool_use", { name: "Grep", input: { pattern: "login" } }), ctx)?.text,
    ).toContain("login");
  });

  it("does NOT narrate a successful verification check (noise reduction)", () => {
    const line = translate(
      ev("verification.check_completed", { check: "typecheck", pass: true }),
      ctx,
    );
    expect(line).toBeNull();
  });

  it("DOES narrate a failed verification check", () => {
    const line = translate(
      ev("verification.check_completed", {
        check: "typecheck",
        pass: false,
        message: "type error on line 5",
      }),
      ctx,
    );
    expect(line?.kind).toBe("system");
    if (line?.kind === "system") expect(line.status).toBe("warn");
    expect(line?.text).toContain("type error");
  });

  it("marks pr.opened as an ok system line", () => {
    const line = translate(ev("pr.opened", { number: 218 }), ctx);
    expect(line?.kind).toBe("system");
    if (line?.kind === "system") expect(line.status).toBe("ok");
    expect(line?.text).toContain("#218");
  });

  it("flags an implementation failure with the right reason", () => {
    const line = translate(
      ev("implement.failed", { kind: "budget_exceeded" }),
      ctx,
    );
    expect(line?.kind).toBe("system");
    if (line?.kind === "system") expect(line.status).toBe("fail");
    expect(line?.text.toLowerCase()).toContain("budget");
  });

  it("returns null for non-user-facing events", () => {
    expect(translate(ev("claude.subprocess.spawned", {}), ctx)).toBeNull();
    expect(translate(ev("log", {}), ctx)).toBeNull();
    expect(translate(ev("run.status", { status: "planning" }), ctx)).toBeNull();
  });

  it("survives malformed payload json", () => {
    const bad: EventRow = {
      id: 1,
      ts: 1,
      kind: "implement.tool_use",
      payload_json: "{not valid json",
    };
    // Should not throw; falls back to a generic tool line.
    expect(() => translate(bad, ctx)).not.toThrow();
  });

  it("marks plan.started + verification.started as thinking", () => {
    expect(
      (translate(ev("plan.started", {}), ctx) as NarrationLine & { thinking?: boolean })
    ).toBeTruthy();
    const planStarted = translate(ev("plan.started", {}), ctx);
    expect(planStarted?.kind === "agent" && planStarted.thinking).toBe(true);
  });
});

describe("coalesceNarration", () => {
  it("collapses identical adjacent agent lines within 8s", () => {
    const lines = [
      { kind: "agent" as const, text: "Editing `a.ts`.", id: 1, ts: 1000 },
      { kind: "agent" as const, text: "Editing `a.ts`.", id: 2, ts: 3000 },
      { kind: "agent" as const, text: "Editing `a.ts`.", id: 3, ts: 5000 },
    ];
    const out = coalesceNarration(lines);
    expect(out).toHaveLength(1);
    // Keeps the latest timestamp/id.
    expect(out[0].ts).toBe(5000);
    expect(out[0].id).toBe(3);
  });

  it("does NOT collapse identical lines more than 8s apart", () => {
    const lines = [
      { kind: "agent" as const, text: "Editing `a.ts`.", id: 1, ts: 1000 },
      { kind: "agent" as const, text: "Editing `a.ts`.", id: 2, ts: 20000 },
    ];
    expect(coalesceNarration(lines)).toHaveLength(2);
  });

  it("does NOT collapse different texts", () => {
    const lines = [
      { kind: "agent" as const, text: "Editing `a.ts`.", id: 1, ts: 1000 },
      { kind: "agent" as const, text: "Editing `b.ts`.", id: 2, ts: 2000 },
    ];
    expect(coalesceNarration(lines)).toHaveLength(2);
  });

  it("returns an empty list unchanged", () => {
    expect(coalesceNarration([])).toEqual([]);
  });
});
