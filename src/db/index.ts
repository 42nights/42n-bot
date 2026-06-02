/**
 * Database entry point — re-exports the Convex client.
 *
 * All call sites that previously imported `db` from here now get the
 * ConvexHttpClient. The actual query/mutation functions live in src/db/ops/*.
 */
export { convex as db, api } from "./convex-client";
