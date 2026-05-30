export type CheckName =
  | "typecheck"
  | "existing_tests"
  | "plan_tests_added"
  | "mutation_light"
  | "lint"
  | "diff_size"
  | "banned_patterns"
  | "critic"
  | "acceptance_tests"
  | "critic_v2"
  | "runtime_verification";

export type CheckResult = {
  name: CheckName;
  pass: boolean;
  hardGate: boolean;
  message: string;
  detail?: unknown;
};

export type Verdict = {
  pass: boolean;
  checks: Record<CheckName, CheckResult>;
  failureSummary: string;
  attempt: number;
};

export type Plan = {
  files_to_change: { path: string; kind: "modify" | "create" | "delete"; why: string }[];
  tests_to_add_or_update: { path: string; describes: string }[];
  user_visible_change: string;
  edge_cases: string[];
  complexity: "trivial" | "small" | "medium" | "large";
  should_abort: boolean;
  abort_reason: string | null;
  /** v2 overhaul: tests that MUST pass for the acceptance criteria.
   *  Optional for back-compat with pre-v2 plans. */
  acceptance_test_paths?: string[];
};
