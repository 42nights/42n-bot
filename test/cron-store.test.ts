import { describe, it, expect } from "vitest";
import { nextFireAt, validateSchedule } from "../src/cron/store";

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
