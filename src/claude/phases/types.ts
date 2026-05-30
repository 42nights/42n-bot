/**
 * Types shared across the new pipeline phases:
 *   UNDERSTAND → REPRODUCE | DESIGN → PLAN → IMPLEMENT → VERIFY
 *
 * The schemas these types correspond to live in src/claude/prompts.ts so the
 * model sees the schema and we get type-safe access to the parsed output.
 *
 * Spec: 42n-bot_actually_fixes_things_overhaul.md §3-§5.
 */

import { z } from "zod";

// ── UNDERSTAND ────────────────────────────────────────────────────────────

export const UnderstandingSchema = z.object({
  issue_type: z.enum([
    "bug",
    "feature",
    "refactor",
    "docs",
    "infra",
    "unclear",
  ]),
  issue_summary: z.string(),
  acceptance_criteria: z.array(z.string()).min(1).max(8),
  user_visible_outcome: z.string(),
  relevant_files: z
    .array(
      z.object({
        path: z.string(),
        relevance: z.enum(["likely_changes", "context_only", "depends_on"]),
        why: z.string(),
      }),
    )
    .min(1),
  unknowns: z.array(z.string()),
  runtime_surface: z.object({
    starts_dev_server: z.boolean(),
    adds_or_modifies_endpoints: z.array(
      z.object({
        method: z.enum(["GET", "POST", "PUT", "PATCH", "DELETE"]),
        path: z.string(),
      }),
    ),
    adds_migration: z.boolean(),
    modifies_database_schema: z.boolean(),
    external_dependencies: z.array(z.string()),
  }),
  confidence_to_proceed: z.number().min(0).max(100),
  proceed: z.boolean(),
  abort_reason: z.string().nullable(),
});

export type Understanding = z.infer<typeof UnderstandingSchema>;

// ── REPRODUCE ─────────────────────────────────────────────────────────────

export const ReproduceSchema = z.object({
  reproduced: z.boolean(),
  test_file_path: z.string(),
  test_describes: z.string(),
  expected_failure_output: z.string(),
  notes: z.string(),
  cannot_reproduce_reason: z.string().nullable(),
});

export type Reproduce = z.infer<typeof ReproduceSchema>;

// ── DESIGN ────────────────────────────────────────────────────────────────

const EndpointShape = z.object({
  method: z.enum(["GET", "POST", "PUT", "PATCH", "DELETE"]),
  path: z.string(),
  request_shape: z.string(),
  response_shape: z.string(),
  error_shapes: z
    .array(
      z.object({
        http_status: z.number(),
        code: z.string(),
        when: z.string(),
      }),
    )
    .optional(),
});

export const DesignSchema = z.object({
  api_surface: z.object({
    new_endpoints: z.array(EndpointShape),
    modified_endpoints: z.array(z.unknown()),
    new_functions: z.array(
      z.object({
        name: z.string(),
        signature: z.string(),
        purpose: z.string(),
      }),
    ),
  }),
  schema_changes: z.object({
    new_tables: z.array(z.unknown()),
    new_columns: z.array(z.unknown()),
    migrations_needed: z.boolean(),
    migration_strategy: z.string().nullable(),
  }),
  integration_points: z.array(
    z.object({
      path: z.string(),
      how: z.string(),
    }),
  ),
  rollback_plan: z.string(),
  out_of_scope: z.array(z.string()),
});

export type Design = z.infer<typeof DesignSchema>;

// ── CRITIC v2 ─────────────────────────────────────────────────────────────

export const CriticV2Schema = z.object({
  implements_acceptance_criteria: z.array(
    z.object({
      criterion: z.string(),
      verdict: z.enum([
        "clearly_yes",
        "probably_yes",
        "uncertain",
        "probably_no",
        "clearly_no",
      ]),
      evidence: z.string(),
    }),
  ),
  test_quality: z.object({
    acceptance_tests_match_criteria: z.boolean(),
    test_code_is_meaningful: z.boolean(),
    false_positive_likely: z.boolean(),
  }),
  hidden_bugs: z.array(
    z.object({
      description: z.string(),
      severity: z.enum(["low", "medium", "high"]),
    }),
  ),
  merge_confidence: z.number().min(0).max(100),
  one_line_summary: z.string(),
});

export type CriticV2Report = z.infer<typeof CriticV2Schema>;

// ── Phase-cost tracker (used by every phase wrapper) ─────────────────────

export type PhaseName =
  | "understand"
  | "reproduce"
  | "design"
  | "plan"
  | "implement"
  | "verify"
  | "replan";
