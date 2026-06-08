import { convex, api } from "../convex-client";

export type AppCredRow = {
  _id: string;
  app_id: number;
  slug: string;
  client_id?: string;
  client_secret?: string;
  webhook_secret?: string;
  private_key_b64: string;
  created_at: number;
};

export async function getAppCreds(): Promise<AppCredRow | null> {
  // Present the shared server token so Convex returns the secret fields
  // (private_key_b64, client_secret, webhook_secret). Browser callers, which
  // lack this token, get those fields stripped — see convex/appCredentials.ts.
  const row = await convex.query(api.appCredentials.get, {
    serverToken: process.env.OTIS_SERVER_SECRET,
  });
  return (row as AppCredRow | null) ?? null;
}

export async function saveAppCredsRow(args: {
  app_id: number;
  slug: string;
  client_id?: string | null;
  client_secret?: string | null;
  webhook_secret?: string | null;
  private_key_b64: string;
}): Promise<void> {
  await convex.mutation(api.appCredentials.save, {
    app_id: args.app_id,
    slug: args.slug,
    client_id: args.client_id ?? undefined,
    client_secret: args.client_secret ?? undefined,
    webhook_secret: args.webhook_secret ?? undefined,
    private_key_b64: args.private_key_b64,
    created_at: Date.now(),
  });
}

export async function getSetupState(
  state: string,
): Promise<{ created_at: number } | null> {
  const row = await convex.query(api.appCredentials.getSetupState, { state });
  return row ? { created_at: row.created_at } : null;
}

export async function insertSetupState(
  state: string,
): Promise<void> {
  await convex.mutation(api.appCredentials.insertSetupState, {
    state,
    created_at: Date.now(),
  });
}

export async function deleteSetupState(state: string): Promise<void> {
  await convex.mutation(api.appCredentials.deleteSetupState, { state });
}

export async function pruneSetupStates(cutoff: number): Promise<void> {
  await convex.mutation(api.appCredentials.pruneSetupStates, { cutoff });
}
