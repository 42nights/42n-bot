import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * QA2/QA3 — cron fire safety: claimDueCron must be the atomic gate.
 * Mocks the Convex ops layer instead of the SQLite db.
 */

let claimResult = true;
let recordThrows: Error | null = null;
const recordCalled = vi.fn();

vi.mock("../src/db/ops/crons", () => ({
  claimDueCron: vi.fn(async () => claimResult),
  recordCronRunRow: vi.fn(async () => {
    recordCalled();
    if (recordThrows) throw recordThrows;
  }),
  listCrons: vi.fn(async () => []),
  getCron: vi.fn(async () => null),
  createCronRow: vi.fn(async () => "mock-id"),
  updateCronRow: vi.fn(async () => null),
  deleteCronRow: vi.fn(async () => false),
  getDueCrons: vi.fn(async () => []),
  pruneCronRunRows: vi.fn(async () => 0),
  listCronRunRows: vi.fn(async () => []),
  forceDueCron: vi.fn(async () => {}),
}));

import { claimDueCron, recordCronRun } from "../src/cron/store";
import type { CronRow } from "../src/cron/store";

const cron: CronRow = {
  _id: "mock-cron-id",
  name: "x",
  schedule: "0 * * * *",
  action: "reviewer" as const,
  payload_json: "{}",
  repo: undefined,
  enabled: 1,
  last_run_at: undefined,
  next_run_at: 1000,
  created_at: 0,
  updated_at: 0,
};

beforeEach(() => {
  claimResult = true;
  recordThrows = null;
  recordCalled.mockClear();
});

describe("claimDueCron", () => {
  it("returns true when the claim succeeded", async () => {
    claimResult = true;
    expect(await claimDueCron(cron)).toBe(true);
  });

  it("returns false when another process already claimed", async () => {
    claimResult = false;
    expect(await claimDueCron(cron)).toBe(false);
  });
});

describe("recordCronRun", () => {
  it("inserts a history row", async () => {
    await recordCronRun("mock-cron-id", { ok: true, message: "ok" });
    expect(recordCalled).toHaveBeenCalledTimes(1);
  });

  it("swallows an FK/not-found error (cron deleted mid-fire)", async () => {
    recordThrows = new Error("FOREIGN KEY constraint failed");
    await expect(recordCronRun("mock-cron-id", { ok: true, message: "ok" })).resolves.not.toThrow();
  });

  it("rethrows non-FK errors", async () => {
    recordThrows = new Error("disk I/O error");
    await expect(recordCronRun("mock-cron-id", { ok: true, message: "ok" })).rejects.toThrow(/disk/);
  });
});
