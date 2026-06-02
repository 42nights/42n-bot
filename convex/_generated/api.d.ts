/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as appCredentials from "../appCredentials.js";
import type * as artifacts from "../artifacts.js";
import type * as chat from "../chat.js";
import type * as corpus from "../corpus.js";
import type * as cronStore from "../cronStore.js";
import type * as dispatch from "../dispatch.js";
import type * as events from "../events.js";
import type * as issueEmbeddings from "../issueEmbeddings.js";
import type * as phaseCosts from "../phaseCosts.js";
import type * as repos from "../repos.js";
import type * as runs from "../runs.js";
import type * as verdicts from "../verdicts.js";
import type * as webhookDeliveries from "../webhookDeliveries.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  appCredentials: typeof appCredentials;
  artifacts: typeof artifacts;
  chat: typeof chat;
  corpus: typeof corpus;
  cronStore: typeof cronStore;
  dispatch: typeof dispatch;
  events: typeof events;
  issueEmbeddings: typeof issueEmbeddings;
  phaseCosts: typeof phaseCosts;
  repos: typeof repos;
  runs: typeof runs;
  verdicts: typeof verdicts;
  webhookDeliveries: typeof webhookDeliveries;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {};
