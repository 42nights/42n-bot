/**
 * SWE-bench adapter constants. Override via CLI flags in harness.ts.
 */

export const HF_DATASETS_BASE =
  "https://datasets-server.huggingface.co/rows";

export const DEFAULTS = {
  dataset: "SWE-bench/SWE-bench_Verified",
  split: "test",
  modelName: "otis-v2",
  concurrency: 3,
  maxCostUsd: Infinity,
  pageSize: 100,
  maxOffset: 500,
  cacheDir: "data/swebench",
  out: "data/swebench/predictions.jsonl",
} as const;

/**
 * Default test-file strip patterns. Applied as regexes against the b/ path of
 * each diff --git block. A file matching any pattern is dropped from the
 * model_patch before writing to predictions.jsonl.
 *
 * Configurable via --strip <comma-list-of-regex-source>.
 */
export const DEFAULT_STRIP_PATTERNS: RegExp[] = [
  /(^|\/)tests?\//,         // any tests/ or test/ dir segment
  /(^|\/)test_[^/]+\.py$/, // test_*.py anywhere
  /[^/]+_test\.py$/,       // *_test.py anywhere
  /(^|\/)conftest\.py$/,   // conftest.py
];

/** Directory where bare-ish clones are cached, relative to cwd. */
export const CLONE_CACHE_DIR = "data/swebench/clones";

/** Path prefix for git worktrees checked out per instance, relative to cwd. */
export const WORKTREE_BASE_DIR = "data/swebench/worktrees";
