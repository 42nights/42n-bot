import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * QA2/QA3 — cron fire safety:
 *  - claimDueCron must be the atomic gate (changes>0 ⇒ this process fires).
 *  - When another process already claimed (next_run_at moved), changes=0 and
 *    we must NOT fire.
 *  - recordCronRun must swallow an FK violation (cron deleted mid-fire)
 *    instead of throwing.
 */

let claimChanges = 1;
let insertThrows: Error | null = null;
const insertRun = vi.fn();

vi.mock("../src/db", () => {
  const prepare = (sql: string) => ({
    get: () => undefined,
    all: () => [],
    run: (..._a: unknown[]) => {
      if (/UPDATE crons SET next_run_at/i.test(sql)) {
        return { changes: claimChanges };
      }
      if (/INSERT INTO cron_runs/i.test(sql)) {
        insertRun();
        if (insertThrows) throw insertThrows;
        return { changes: 1, lastInsertRowid: 1 };
      }
      return { changes: 1, lastInsertRowid: 1 };
    },
  });
  return { db: { prepare } };
});

import { claimDueCron, recordCronRun } from "../src/cron/store";

const cron = {
  id: 1,
  name: "x",
  schedule: "0 * * * *",
  action: "reviewer" as const,
  payload_json: "{}",
  repo: null,
  enabled: 1,
  last_run_at: null,
  next_run_at: 1000,
  created_at: 0,
  updated_at: 0,
};

beforeEach(() => {
  claimChanges = 1;
  insertThrows = null;
  insertRun.mockClear();
});

describe("claimDueCron", () => {
  it("returns true when the conditional UPDATE matched (we won the claim)", () => {
    claimChanges = 1;
    expect(claimDueCron(cron)).toBe(true);
  });

  it("returns false when another process already claimed (no rows matched)", () => {
    claimChanges = 0;
    expect(claimDueCron(cron)).toBe(false);
  });
});

describe("recordCronRun", () => {
  it("inserts a history row", () => {
    recordCronRun(1, { ok: true, message: "ok" });
    expect(insertRun).toHaveBeenCalledTimes(1);
  });

  it("swallows an FK violation (cron deleted mid-fire)", () => {
    insertThrows = new Error("FOREIGN KEY constraint failed");
    expect(() => recordCronRun(1, { ok: true, message: "ok" })).not.toThrow();
  });

  it("rethrows non-FK errors", () => {
    insertThrows = new Error("disk I/O error");
    expect(() => recordCronRun(1, { ok: true, message: "ok" })).toThrow(/disk/);
  });
});
