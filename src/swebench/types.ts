import type { IssueForPrompt } from "../claude/prompts";

/** One row from the SWE-bench HuggingFace dataset. */
export type SwebenchInstance = {
  instance_id: string;
  repo: string;              // "owner/name"
  base_commit: string;       // SHA the model must patch from
  problem_statement: string;
  hints_text: string | null;
  version: string | null;
  environment_setup_commit: string | null;
  // Gold patches — present in the API response and cached, but NEVER shown
  // to the agent. Only the grading harness reads them.
  patch: string | null;
  test_patch: string | null;
  // Test oracle — JSON-encoded string arrays of pytest node IDs. Read only by
  // the grader, never by the agent.
  FAIL_TO_PASS: string;
  PASS_TO_PASS: string;
};

/** One line in predictions.jsonl (SWE-bench wire format). */
export type Prediction = {
  instance_id: string;
  model_name_or_path: string;
  model_patch: string;       // "" = unresolved
};

export type RunOutcome =
  | "succeeded"
  | "abandoned"
  | "failed";

export type HarnessOpts = {
  dataset: string;
  split: string;
  cacheDir: string;
  instances: string[] | null; // filter by id; null = all
  limit: number | null;
  concurrency: number;
  maxCostUsd: number;
  out: string;
  resume: boolean;
  modelName: string;
  stripPatterns: RegExp[];
  noVenv: boolean;
  perRunCap: number;
  // Off by default: lab leaderboard numbers are problem_statement-only, and
  // hints_text (the issue's pre-PR comment thread) frequently contains the
  // actual fix. Including it inflates the score and breaks comparability.
  includeHints: boolean;
};

/** Returned by runInstance, consumed by harness. */
export type InstanceResult = {
  instance_id: string;
  model_patch: string;
  outcome: RunOutcome;
  costUsd: number;
};

/**
 * Synthesized issue for the Otis phase pipeline. The agent only ever sees
 * this — gold patches are never exposed.
 */
export type IssueFromInstance = IssueForPrompt;
