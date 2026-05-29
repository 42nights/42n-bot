import { describe, it, expect } from "vitest";
import { assertNotProtected } from "../src/coordinator/worktree";

describe("assertNotProtected", () => {
  it("allows bot branch names", () => {
    expect(() => assertNotProtected("bot/issue-42-abc")).not.toThrow();
  });
  it("blocks main, master, trunk, develop", () => {
    for (const ref of ["main", "master", "trunk", "develop"]) {
      expect(() => assertNotProtected(ref)).toThrow(/protected ref/);
    }
  });
});
