import { describe, it, expect } from "vitest";
import {
  nextFireAt,
  validateSchedule,
  validatePayload,
} from "../src/cron/store";

describe("validatePayload (QA3 resource-exhaustion guard)", () => {
  it("rejects an oversized payload", () => {
    const big = { title: "x", body: "A".repeat(20_000) };
    const r = validatePayload("send_otis", big);
    expect(r.ok).toBe(false);
  });

  it("send_otis requires a non-empty title", () => {
    expect(validatePayload("send_otis", { body: "hi" }).ok).toBe(false);
    expect(validatePayload("send_otis", { title: "  " }).ok).toBe(false);
  });

  it("send_otis rejects an over-long title", () => {
    expect(
      validatePayload("send_otis", { title: "x".repeat(300) }).ok,
    ).toBe(false);
  });

  it("accepts a valid send_otis payload", () => {
    expect(
      validatePayload("send_otis", { title: "Daily digest", body: "hi" }).ok,
    ).toBe(true);
  });

  it("fix_issue requires a numeric issue_number", () => {
    expect(validatePayload("fix_issue", {}).ok).toBe(false);
    expect(
      validatePayload("fix_issue", { issue_number: "5" as unknown as number })
        .ok,
    ).toBe(false);
    expect(validatePayload("fix_issue", { issue_number: 5 }).ok).toBe(true);
  });

  it("reviewer accepts an empty payload", () => {
    expect(validatePayload("reviewer", {}).ok).toBe(true);
  });
});

describe("validateSchedule", () => {
  it("accepts standard 5-field expressions", () => {
    expect(validateSchedule("0 * * * *").ok).toBe(true);
    expect(validateSchedule("0 9 * * 1-5").ok).toBe(true);
    expect(validateSchedule("*/15 * * * *").ok).toBe(true);
  });

  it("rejects garbage", () => {
    expect(validateSchedule("not a cron").ok).toBe(false);
    expect(validateSchedule("99 99 99 99 99").ok).toBe(false);
  });

  it("returns a future nextRun timestamp on success", () => {
    const v = validateSchedule("0 * * * *");
    expect(v.ok).toBe(true);
    expect(v.nextRun).toBeGreaterThan(Date.now());
  });
});

describe("nextFireAt", () => {
  it("returns the next top-of-hour for an hourly cron", () => {
    // Lock the baseline so we can assert the answer.
    const baseline = new Date("2026-06-01T10:30:00Z").getTime();
    const next = nextFireAt("0 * * * *", baseline);
    expect(next).toBe(new Date("2026-06-01T11:00:00Z").getTime());
  });

  it("returns null for an invalid expression instead of throwing", () => {
    expect(nextFireAt("garbage")).toBeNull();
  });
});
