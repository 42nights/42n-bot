import { Octokit } from "@octokit/rest";
import { retry } from "@octokit/plugin-retry";
import { createAppAuth } from "@octokit/auth-app";
import { ensureSchema } from "../db/migrate";
import { log } from "../shared/logger";
import {
  getAppCreds,
  saveAppCredsRow,
  getSetupState,
  insertSetupState,
  deleteSetupState,
  pruneSetupStates,
} from "../db/ops/appCredentials";
import { getRepoByOwnerName } from "../db/ops/repos";

const OctokitWithRetry = Octokit.plugin(retry);

export type AppCreds = {
  appId: number;
  privateKey: string;
  clientId?: string;
  clientSecret?: string;
  installationId?: number;
};

export async function readAppCreds(): Promise<AppCreds | null> {
  const fromDb = await readAppCredsFromDb();
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
      /* leave as-is */
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

async function readAppCredsFromDb(): Promise<AppCreds | null> {
  try {
    const row = await getAppCreds();
    // `private_key_b64` is absent when Convex stripped the secret fields because
    // OTIS_SERVER_SECRET wasn't presented/configured. Treat that as "no DB
    // creds" and fall back to env vars rather than constructing a broken App.
    if (!row?.private_key_b64) return null;
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

export async function dbAppSlug(): Promise<string | null> {
  try {
    const row = await getAppCreds();
    return row?.slug ?? null;
  } catch {
    return null;
  }
}

export async function appConfigured(): Promise<boolean> {
  return (await readAppCreds()) !== null;
}

export async function readWebhookSecret(): Promise<string | null> {
  try {
    const row = await getAppCreds();
    if (row?.webhook_secret) return row.webhook_secret;
  } catch {
    /* table may not be configured yet */
  }
  return process.env.GITHUB_WEBHOOK_SECRET ?? null;
}

export async function appName(): Promise<string | null> {
  return (await dbAppSlug()) ?? process.env.GITHUB_APP_NAME ?? null;
}

export async function ghApp(): Promise<InstanceType<typeof OctokitWithRetry>> {
  const creds = await readAppCreds();
  if (!creds) throw new Error("GitHub App is not configured");
  return new OctokitWithRetry({
    authStrategy: createAppAuth,
    auth: { appId: creds.appId, privateKey: creds.privateKey },
    userAgent: "42n-bot/0.1",
    retry: { doNotRetry: [401, 403, 404, 422] },
  });
}

const INSTALLATION_CACHE_TTL_MS = 30 * 60 * 1000;

type CachedInstallation = {
  client: InstanceType<typeof OctokitWithRetry>;
  mintedAt: number;
};

const installationCache = new Map<number, CachedInstallation>();

export function invalidateInstallation(installationId: number): void {
  installationCache.delete(installationId);
}

export async function ghInstallation(
  installationId: number,
): Promise<InstanceType<typeof OctokitWithRetry>> {
  const cached = installationCache.get(installationId);
  if (cached && Date.now() - cached.mintedAt < INSTALLATION_CACHE_TTL_MS) {
    return cached.client;
  }
  const creds = await readAppCreds();
  if (!creds) throw new Error("GitHub App is not configured");
  const client = new OctokitWithRetry({
    authStrategy: createAppAuth,
    auth: { appId: creds.appId, privateKey: creds.privateKey, installationId },
    userAgent: "42n-bot/0.1",
    retry: { doNotRetry: [401, 403, 404, 422] },
  });
  installationCache.set(installationId, { client, mintedAt: Date.now() });
  return client;
}

export async function installationIdForRepo(
  owner: string,
  repo: string,
): Promise<number | null> {
  const row = await getRepoByOwnerName(owner, repo);
  return row?.installation_id ?? null;
}

export async function listInstallationRepos(installationId: number): Promise<
  Array<{
    owner: string;
    name: string;
    default_branch: string;
    html_url: string;
    description: string | null;
  }>
> {
  const CAP = 5000;
  const octo = await ghInstallation(installationId);
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
        if (out.length >= CAP) {
          log.warn(
            "gh-app",
            `installation ${installationId} has >= ${CAP} repos — only first ${CAP} connected.`,
          );
          return out;
        }
      }
    }
  } catch (err) {
    log.warn("gh-app", `listInstallationRepos failed: ${err}`);
    throw err;
  }
  return out;
}

export async function installUrl(): Promise<string | null> {
  const name = await appName();
  if (!name) return null;
  return `https://github.com/apps/${name}/installations/new`;
}

export async function saveAppCreds(args: {
  appId: number;
  slug: string;
  clientId: string | null;
  clientSecret: string | null;
  webhookSecret: string | null;
  privateKeyPem: string;
}): Promise<void> {
  ensureSchema();
  installationCache.clear();
  const pkB64 = Buffer.from(args.privateKeyPem, "utf8").toString("base64");
  await saveAppCredsRow({
    app_id: args.appId,
    slug: args.slug,
    client_id: args.clientId,
    client_secret: args.clientSecret,
    webhook_secret: args.webhookSecret,
    private_key_b64: pkB64,
  });
  log.info("gh-app", `saved credentials for App ${args.slug} (id=${args.appId})`);
}

// App setup state helpers (used by the manifest flow routes).
export { getSetupState, insertSetupState, deleteSetupState, pruneSetupStates };
