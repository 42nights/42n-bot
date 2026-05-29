import { describe, it, expect } from "vitest";
import { createHmac } from "node:crypto";
import { verifyGitHubSignature } from "../src/github/webhook";

function sign(secret: string, body: string) {
  return "sha256=" + createHmac("sha256", secret).update(body).digest("hex");
}

describe("verifyGitHubSignature", () => {
  const secret = "test-secret";
  const body = JSON.stringify({ action: "labeled", number: 42 });

  it("accepts a correct signature", () => {
    expect(verifyGitHubSignature(body, sign(secret, body), secret)).toBe(true);
  });

  it("rejects a tampered body", () => {
    expect(verifyGitHubSignature(body + " ", sign(secret, body), secret)).toBe(false);
  });

  it("rejects a wrong secret", () => {
    expect(verifyGitHubSignature(body, sign("other", body), secret)).toBe(false);
  });

  it("rejects a missing prefix", () => {
    const bare = createHmac("sha256", secret).update(body).digest("hex");
    expect(verifyGitHubSignature(body, bare, secret)).toBe(false);
  });

  it("rejects an empty header", () => {
    expect(verifyGitHubSignature(body, "", secret)).toBe(false);
  });
});
