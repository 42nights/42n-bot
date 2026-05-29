import crypto from "node:crypto";

export type GitHubEvent = {
  action?: string;
  issue?: {
    number: number;
    title: string;
    body?: string;
    labels?: Array<string | { name?: string }>;
  };
  pull_request?: {
    number: number;
    merged: boolean;
    head?: { ref: string };
  };
  repository?: {
    full_name: string;
    name: string;
    owner: { login: string };
  };
  sender?: { login: string };
};

/**
 * GitHub signs `X-Hub-Signature-256` as `sha256=<hex>` over the raw request
 * body, keyed with the shared webhook secret. Verify with constant-time
 * comparison; rejecting silently with === is a timing-attack vector.
 */
export function verifyGitHubSignature(
  rawBody: string,
  signature: string,
  secret: string,
): boolean {
  if (!signature.startsWith("sha256=")) return false;
  const provided = signature.slice("sha256=".length);
  const expected = crypto
    .createHmac("sha256", secret)
    .update(rawBody, "utf8")
    .digest("hex");
  const providedBuf = Buffer.from(provided, "hex");
  const expectedBuf = Buffer.from(expected, "hex");
  if (providedBuf.length !== expectedBuf.length) return false;
  return crypto.timingSafeEqual(providedBuf, expectedBuf);
}

export function eventLabelsInclude(
  evt: GitHubEvent,
  label: string,
): boolean {
  const labels = evt.issue?.labels ?? [];
  return labels.some((l) =>
    typeof l === "string" ? l === label : l?.name === label,
  );
}
