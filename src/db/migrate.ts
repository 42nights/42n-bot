import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { db } from "./index";

function resolveSchemaPath(): string {
  // Candidates, in order of preference, that survive both `tsx` and Turbopack's
  // bundle rewrites (which replaces __dirname with "/ROOT").
  const candidates: string[] = [];
  try {
    if (typeof __dirname === "string" && __dirname !== "/ROOT") {
      candidates.push(path.join(__dirname, "schema.sql"));
    }
  } catch {
    /* not defined under ESM */
  }
  try {
    const url = (import.meta as { url?: string }).url;
    if (url) candidates.push(path.join(path.dirname(fileURLToPath(url)), "schema.sql"));
  } catch {
    /* import.meta not available */
  }
  candidates.push(path.join(process.cwd(), "src", "db", "schema.sql"));
  for (const p of candidates) {
    if (fs.existsSync(p)) return p;
  }
  throw new Error(
    `schema.sql not found. Tried: ${candidates.join(", ")}`,
  );
}

function hasColumn(table: string, column: string): boolean {
  const rows = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{
    name: string;
  }>;
  return rows.some((r) => r.name === column);
}

function addColumnIfMissing(table: string, column: string, ddl: string) {
  if (!hasColumn(table, column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${ddl}`);
  }
}

export function runMigrations() {
  const sql = fs.readFileSync(resolveSchemaPath(), "utf8");
  db.exec(sql);

  // Columns added after the initial schema. ALTER TABLE keeps existing data.
  addColumnIfMissing("repos", "repo_dir", "TEXT");
  addColumnIfMissing("repos", "repo_url", "TEXT");
  addColumnIfMissing("repos", "description", "TEXT");
  addColumnIfMissing("repos", "installation_id", "INTEGER");

  // v0.2 phases overhaul — UNDERSTAND/REPRODUCE/DESIGN/replan + acceptance
  // criteria + runtime verification. All additive; existing rows keep working.
  addColumnIfMissing("runs", "issue_type", "TEXT");
  addColumnIfMissing("runs", "understanding_json", "TEXT");
  addColumnIfMissing("runs", "acceptance_test_paths_json", "TEXT");
  addColumnIfMissing("runs", "runtime_verification_json", "TEXT");
  addColumnIfMissing("runs", "replan_count", "INTEGER NOT NULL DEFAULT 0");

  db.exec(`
    CREATE TABLE IF NOT EXISTS phase_costs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      run_id INTEGER NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
      phase TEXT NOT NULL,
      attempt INTEGER NOT NULL DEFAULT 1,
      cost_usd REAL NOT NULL DEFAULT 0,
      duration_ms INTEGER NOT NULL DEFAULT 0,
      ok INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_phase_costs_run ON phase_costs(run_id, phase);

    -- v0.3 crons: user-scheduled recurring actions (reviewer passes,
    -- file-an-issue, etc). Scheduler ticks every 30s in the coordinator.
    CREATE TABLE IF NOT EXISTS crons (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      schedule TEXT NOT NULL,                -- standard cron expression
      action TEXT NOT NULL,                  -- "reviewer" | "fix_issue" | "send_otis"
      payload_json TEXT NOT NULL,            -- action-specific args
      repo TEXT,                             -- "owner/name" or NULL = first connected
      enabled INTEGER NOT NULL DEFAULT 1,
      last_run_at INTEGER,
      next_run_at INTEGER,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_crons_next_run ON crons(next_run_at);

    CREATE TABLE IF NOT EXISTS cron_runs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      cron_id INTEGER NOT NULL REFERENCES crons(id) ON DELETE CASCADE,
      started_at INTEGER NOT NULL,
      finished_at INTEGER,
      ok INTEGER NOT NULL DEFAULT 0,
      message TEXT,
      run_id INTEGER                          -- when the cron spawned a run, link it
    );

    CREATE INDEX IF NOT EXISTS idx_cron_runs_cron ON cron_runs(cron_id, started_at DESC);

    CREATE TABLE IF NOT EXISTS app_credentials (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      app_id INTEGER NOT NULL,
      slug TEXT NOT NULL,
      client_id TEXT,
      client_secret TEXT,
      webhook_secret TEXT,
      private_key_b64 TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS app_setup_state (
      state TEXT PRIMARY KEY,
      created_at INTEGER NOT NULL
    );
  `);
}

let ensured = false;
export function ensureSchema() {
  if (ensured) return;
  const row = db
    .prepare(
      `SELECT name FROM sqlite_master WHERE type='table' AND name='runs'`,
    )
    .get();
  if (!row) {
    runMigrations();
  } else {
    // Even if `runs` exists, ensure the additive columns are in place. Cheap.
    runMigrations();
  }
  ensured = true;
}
