import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * QA2 — markCronFired must not throw or loop when the cron row was deleted
 * between scheduler pickup and the fire-record. We mock the db layer to
 * simulate "row gone" and assert the function returns cleanly without
 * attempting the transaction (which would FK-violate).
 */

type Stmt = {
  get: (...a: unknown[]) => unknown;
  run: (...a: unknown[]) => unknown;
  all: (...a: unknown[]) => unknown;
};

const txRan = vi.fn();
let rowExists = true;

vi.mock("../src/db", () => {
  const prepare = (sql: string): Stmt => ({
    get: () => {
      // The existence check: `SELECT 1 FROM crons WHERE id = ?`
      if (/SELECT 1 FROM crons/i.test(sql)) {
        return rowExists ? { 1: 1 } : undefined;
      }
      // getCron fallback
      if (/SELECT \* FROM crons WHERE id/i.test(sql)) {
        return rowExists
          ? { id: 1, schedule: "0 * * * *" }
          : undefined;
      }
      return undefined;
    },
    run: () => ({ changes: 1, lastInsertRowid: 1 }),
    all: () => [],
  });
  return {
    db: {
      prepare,
      transaction: (fn: () => void) => {
        return () => {
          txRan();
          fn();
        };
      },
    },
  };
});

import { markCronFired } from "../src/cron/store";

beforeEach(() => {
  txRan.mockClear();
  rowExists = true;
});

describe("markCronFired safety", () => {
  it("runs the transaction when the row still exists", () => {
    rowExists = true;
    markCronFired({ id: 1, schedule: "0 * * * *" }, { ok: true, message: "ok" });
    expect(txRan).toHaveBeenCalledTimes(1);
  });

  it("returns cleanly without a transaction when the row was deleted", () => {
    rowExists = false;
    expect(() =>
      markCronFired({ id: 1, schedule: "0 * * * *" }, { ok: true, message: "ok" }),
    ).not.toThrow();
    expect(txRan).not.toHaveBeenCalled();
  });
});
