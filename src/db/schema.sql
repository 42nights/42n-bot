PRAGMA foreign_keys = ON;
PRAGMA journal_mode = WAL;

CREATE TABLE IF NOT EXISTS repos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  owner TEXT NOT NULL,
  name TEXT NOT NULL,
  default_branch TEXT NOT NULL DEFAULT 'main',
  enabled INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE(owner, name)
);

CREATE TABLE IF NOT EXISTS runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  type TEXT NOT NULL,                        -- "implement" | "review"
  repo TEXT NOT NULL,                         -- "owner/repo"
  issue_number INTEGER,
  issue_title TEXT,
  issue_body TEXT,
  branch_name TEXT,
  pr_number INTEGER,
  pr_url TEXT,
  status TEXT NOT NULL,                       -- queued|planning|implementing|verifying|iterating|pr-opened|succeeded|needs-review|failed|abandoned
  worktree_path TEXT,
  attempts INTEGER NOT NULL DEFAULT 0,
  cost_usd REAL NOT NULL DEFAULT 0,
  started_at INTEGER NOT NULL,
  finished_at INTEGER,
  error_message TEXT
);

CREATE INDEX IF NOT EXISTS idx_runs_status ON runs(status);
CREATE INDEX IF NOT EXISTS idx_runs_issue ON runs(repo, issue_number);
CREATE INDEX IF NOT EXISTS idx_runs_started ON runs(started_at);

CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id INTEGER NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
  ts INTEGER NOT NULL,
  kind TEXT NOT NULL,
  payload_json TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_events_run ON events(run_id, ts);
CREATE INDEX IF NOT EXISTS idx_events_kind ON events(kind);

CREATE TABLE IF NOT EXISTS artifacts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id INTEGER NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,                         -- plan|diff|test_output|lint_output|critic_report
  content TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_artifacts_run ON artifacts(run_id, kind);

CREATE TABLE IF NOT EXISTS verdicts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id INTEGER NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
  attempt INTEGER NOT NULL,
  pass INTEGER NOT NULL,
  checks_json TEXT NOT NULL,
  failure_summary TEXT,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_verdicts_run ON verdicts(run_id, attempt);

-- Phase 3: chat over the bot's own event log.
CREATE TABLE IF NOT EXISTS corpus_chunks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id INTEGER REFERENCES runs(id) ON DELETE CASCADE,
  text TEXT NOT NULL,
  embedding BLOB,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_corpus_run ON corpus_chunks(run_id);

CREATE TABLE IF NOT EXISTS chat_threads (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS chat_messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  thread_id INTEGER NOT NULL REFERENCES chat_threads(id) ON DELETE CASCADE,
  role TEXT NOT NULL,
  content TEXT NOT NULL,
  citations_json TEXT,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_chat_messages_thread ON chat_messages(thread_id, created_at);

-- Cross-process dispatch signal. The webhook writes here; the coordinator
-- polls on a 2s tick and drains. Single row keyed by `name`.
CREATE TABLE IF NOT EXISTS dispatch_signals (
  name TEXT PRIMARY KEY,
  dirty INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL
);

-- Reviewer dedupe cache: persisted embeddings for open issues so we don't
-- re-embed the world every 6h. Invalidated when GitHub reports a newer
-- updated_at than the cached one.
CREATE TABLE IF NOT EXISTS issue_embeddings (
  repo TEXT NOT NULL,
  issue_number INTEGER NOT NULL,
  updated_at TEXT NOT NULL,                    -- GitHub's ISO updated_at
  embedding BLOB NOT NULL,
  cached_at INTEGER NOT NULL,
  PRIMARY KEY (repo, issue_number)
);
