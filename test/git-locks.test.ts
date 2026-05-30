import { describe, it, expect, beforeEach, afterEach } from "vitest";
import path from "node:path";
import fs from "node:fs/promises";
import os from "node:os";
import { clearGitLocks } from "../src/coordinator/worktree";

describe("clearGitLocks", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "42n-locks-"));
    await fs.mkdir(path.join(tmpDir, ".git"), { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it("removes config.lock and index.lock when present", async () => {
    await fs.writeFile(path.join(tmpDir, ".git/config.lock"), "");
    await fs.writeFile(path.join(tmpDir, ".git/index.lock"), "");
    await clearGitLocks(tmpDir);
    await expect(
      fs.access(path.join(tmpDir, ".git/config.lock")),
    ).rejects.toThrow();
    await expect(
      fs.access(path.join(tmpDir, ".git/index.lock")),
    ).rejects.toThrow();
  });

  it("is a no-op when no lock files exist", async () => {
    await expect(clearGitLocks(tmpDir)).resolves.toBeUndefined();
  });

  it("doesn't touch unrelated files in .git", async () => {
    await fs.writeFile(path.join(tmpDir, ".git/config"), "keep me");
    await clearGitLocks(tmpDir);
    const kept = await fs.readFile(path.join(tmpDir, ".git/config"), "utf8");
    expect(kept).toBe("keep me");
  });
});
