/**
 * Convex HTTP client singleton.
 *
 * Both the Next.js dashboard (server-side routes) and the coordinator daemon
 * use this module to reach the same hosted Convex deployment. No SQLite.
 */
import { ConvexHttpClient } from "convex/browser";
import { api } from "../../convex/_generated/api";

if (!process.env.NEXT_PUBLIC_CONVEX_URL) {
  throw new Error("NEXT_PUBLIC_CONVEX_URL is not set");
}

// Single shared client instance (globalThis cache survives Next.js HMR reloads).
declare global {
  // eslint-disable-next-line no-var
  var __convex_client: ConvexHttpClient | undefined;
}

function makeClient(): ConvexHttpClient {
  return new ConvexHttpClient(process.env.NEXT_PUBLIC_CONVEX_URL!);
}

export const convex: ConvexHttpClient =
  globalThis.__convex_client ?? makeClient();
if (!globalThis.__convex_client) globalThis.__convex_client = convex;

export { api };
