import { Octokit } from "@octokit/rest";
import { retry } from "@octokit/plugin-retry";
import { createAppAuth } from "@octokit/auth-app";
import { db } from "../db";
import { ensureSchema } from "../db/migrate";
import { log } from "../shared/logger";

const OctokitWithRetry = Octokit.plugin(retry);

export type AppCreds = {
  appId: number;
  privateKey: string;
  clientId?: string;
  clientSecret?: string;
  installationId?: number;
};

/**
 * Read GitHub App credentials. DB first (manifest auto-setup writes here);
 * fall back to env vars so a manual setup still works. Returns null if neither
 * is wired up, in which case callers should fall back to PAT (`GITHUB_TOKEN`).
 *
 * GITHUB_APP_PRIVATE_KEY env can be raw multi-line PEM (quoted in .env) or
 * base64-encoded PEM (auto-detected when input has no whitespace).
 */
export function readAppCreds(): AppCreds | null {
  const fromDb = readAppCredsFromDb();
  if (fromDb) return fromDb;

  const appIdRaw = process.env.GITHUB_APP_ID;
  const keyRaw = process.env.GITHUB_APP_PRIVATE_KEY;
  if (!appIdRaw || !keyRaw) return null;
  const appId = Number(appIdRaw);
  if (!Number.isFinite(appId)) return null;

  let privateKey = keyRaw.trim();
  if (!privateKey.includes("BEGIN") && !privateKey.includes("\n")) {
    try {
      privateKey = Buffer.from(privateKey, "base64").toString("utf8");
    } catch {
      /* leave as-is — will fail below with a clearer error */
    }
  }
  privateKey = privateKey.replace(/\\n/g, "\n");

  return {
    appId,
    privateKey,
    clientId: process.env.GITHUB_APP_CLIENT_ID,
    clientSecret: process.env.GITHUB_APP_CLIENT_SECRET,
  };
}

function readAppCredsFromDb(): AppCreds | null {
  try {
    const row = db
      .prepare(
        `SELECT app_id, slug, client_id, client_secret, private_key_b64
           FROM app_credentials WHERE id = 1`,
      )
      .get() as
      | {
          app_id: number;
          slug: string;
          client_id: string | null;
          client_secret: string | null;
          private_key_b64: string;
        }
      | undefined;
    if (!row) return null;
    return {
      appId: row.app_id,
      privateKey: Buffer.from(row.private_key_b64, "base64").toString("utf8"),
      clientId: row.client_id ?? undefined,
      clientSecret: row.client_secret ?? undefined,
    };
  } catch {
    return null;
  }
}

export function dbAppSlug(): string | null {
  try {
    const row = db
      .prepare(`SELECT slug FROM app_credentials WHERE id = 1`)
      .get() as { slug: string } | undefined;
    return row?.slug ?? null;
  } catch {
    return null;
  }
}

export function appConfigured(): boolean {
  return readAppCreds() !== null;
}

export function appName(): string | null {
  return dbAppSlug() ?? process.env.GITHUB_APP_NAME ?? null;
}

/**
 * Octokit signed as the App itself (used to list installations, fetch
 * installation metadata). Short-lived JWT, minted per call by Octokit.
 */
export function ghApp(): InstanceType<typeof OctokitWithRetry> {
  const creds = readAppCreds();
  if (!creds) throw new Error("GitHub App is not configured");
  return new OctokitWithRetry({
    authStrategy: createAppAuth,
    auth: {
      appId: creds.appId,
      privateKey: creds.privateKey,
    },
    userAgent: "42n-bot/0.1",
    retry: { doNotRetry: [401, 403, 404, 422] },
  });
}

/**
 * Octokit authed as a specific installation. Installation tokens last 1 hour;
 * Octokit's auth-app strategy handles minting + refresh internally, so we
 * cache the Octokit instance keyed by installationId.
 */
const installationCache = new Map<
  number,
  InstanceType<typeof OctokitWithRetry>
>();

export function ghInstallation(
  installationId: number,
): InstanceType<typeof OctokitWithRetry> {
  const cached = installationCache.get(installationId);
  if (cached) return cached;
  const creds = readAppCreds();
  if (!creds) throw new Error("GitHub App is not configured");
  const client = new OctokitWithRetry({
    authStrategy: createAppAuth,
    auth: {
      appId: creds.appId,
      privateKey: creds.privateKey,
      installationId,
    },
    userAgent: "42n-bot/0.1",
    retry: { doNotRetry: [401, 403, 404, 422] },
  });
  installationCache.set(installationId, client);
  return client;
}

/**
 * Look up the installation_id for a connected repo. Returns null if the repo
 * isn't connected via the GitHub App (e.g., still using PAT).
 */
export function installationIdForRepo(
  owner: string,
  repo: string,
): number | null {
  const row = db
    .prepare(`SELECT installation_id FROM repos WHERE owner=? AND name=?`)
    .get(owner, repo) as { installation_id: number | null } | undefined;
  return row?.installation_id ?? null;
}

/**
 * List all repos visible to a given installation. Used by the post-install
 * callback to upsert connected repos in one shot.
 */
export async function listInstallationRepos(installationId: number): Promise<
  Array<{
    owner: string;
    name: string;
    default_branch: string;
    html_url: string;
    description: string | null;
  }>
> {
  const octo = ghInstallation(installationId);
  const out: Array<{
    owner: string;
    name: string;
    default_branch: string;
    html_url: string;
    description: string | null;
  }> = [];
  try {
    for await (const page of octo.paginate.iterator(
      "GET /installation/repositories",
      { per_page: 100 },
    )) {
      const data = page.data as Array<{
        name: string;
        owner: { login: string };
        default_branch: string;
        html_url: string;
        description: string | null;
      }>;
      for (const r of data) {
        out.push({
          owner: r.owner.login,
          name: r.name,
          default_branch: r.default_branch,
          html_url: r.html_url,
          description: r.description,
        });
      }
    }
  } catch (err) {
    log.warn("gh-app", `listInstallationRepos failed: ${err}`);
    throw err;
  }
  return out;
}

export function installUrl(): string | null {
  const name = appName();
  if (!name) return null;
  return `https://github.com/apps/${name}/installations/new`;
}

/**
 * Persist credentials returned by the manifest-flow conversions endpoint.
 * Singleton row (CHECK id=1) so re-running the flow overwrites cleanly.
 */
export function saveAppCreds(args: {
  appId: number;
  slug: string;
  clientId: string | null;
  clientSecret: string | null;
  webhookSecret: string | null;
  privateKeyPem: string;
}): void {
  ensureSchema();
  // Re-registering the App invalidates every cached installation token —
  // they were minted with the old private key. Drop the cache so the next
  // `ghInstallation()` call mints fresh ones.
  installationCache.clear();
  const pkB64 = Buffer.from(args.privateKeyPem, "utf8").toString("base64");
  db.prepare(
    `INSERT INTO app_credentials (id, app_id, slug, client_id, client_secret, webhook_secret, private_key_b64, created_at)
     VALUES (1, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       app_id=excluded.app_id,
       slug=excluded.slug,
       client_id=excluded.client_id,
       client_secret=excluded.client_secret,
       webhook_secret=excluded.webhook_secret,
       private_key_b64=excluded.private_key_b64,
       created_at=excluded.created_at`,
  ).run(
    args.appId,
    args.slug,
    args.clientId,
    args.clientSecret,
    args.webhookSecret,
    pkB64,
    Date.now(),
  );
  log.info("gh-app", `saved credentials for App ${args.slug} (id=${args.appId})`);
}
