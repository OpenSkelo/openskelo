import Database from "better-sqlite3";
import { resolve } from "path";
import { mkdirSync } from "fs";

const SCHEMA = `
CREATE TABLE IF NOT EXISTS tasks (
  id TEXT PRIMARY KEY,
  pipeline TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT DEFAULT '',
  status TEXT NOT NULL DEFAULT 'PENDING',
  assigned TEXT DEFAULT '',
  notes TEXT DEFAULT '',
  metadata TEXT DEFAULT '{}',
  bounce_count INTEGER DEFAULT 0,
  priority TEXT DEFAULT 'P2',
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS agents (
  id TEXT PRIMARY KEY,
  role TEXT NOT NULL,
  capabilities TEXT DEFAULT '[]',
  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  status TEXT DEFAULT 'idle',
  current_task TEXT,
  config TEXT DEFAULT '{}'
);

CREATE TABLE IF NOT EXISTS audit_log (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL,
  from_status TEXT,
  to_status TEXT NOT NULL,
  agent TEXT,
  gates TEXT DEFAULT '[]',
  notes TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS gate_log (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL,
  gate_name TEXT NOT NULL,
  transition TEXT NOT NULL,
  result TEXT NOT NULL,
  reason TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS dispatch_queue (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL,
  agent_id TEXT NOT NULL,
  status TEXT DEFAULT 'pending',
  attempts INTEGER DEFAULT 0,
  last_error TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  dispatched_at TEXT,
  completed_at TEXT
);

CREATE TABLE IF NOT EXISTS runs (
  id TEXT PRIMARY KEY,
  original_prompt TEXT NOT NULL,
  current_block TEXT NOT NULL,
  iteration INTEGER NOT NULL DEFAULT 1,
  run_version INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'running',
  artifact_path TEXT,
  artifact_preview TEXT,
  context TEXT DEFAULT '{}',
  blocks TEXT DEFAULT '[]',
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS run_events (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  block TEXT NOT NULL,
  transition TEXT NOT NULL,
  result TEXT NOT NULL,
  details TEXT DEFAULT '{}',
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS run_steps (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  step_index INTEGER NOT NULL,
  transition TEXT NOT NULL,
  block TEXT NOT NULL,
  iteration INTEGER NOT NULL,
  agent TEXT NOT NULL,
  output TEXT NOT NULL,
  artifact_path TEXT,
  artifact_preview TEXT,
  context_snapshot TEXT DEFAULT '{}',
  timestamp TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now')),
  UNIQUE(run_id, step_index)
);

CREATE TABLE IF NOT EXISTS run_step_idempotency (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  request_hash TEXT NOT NULL,
  status_code INTEGER NOT NULL,
  response_json TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now')),
  UNIQUE(run_id, idempotency_key)
);

-- Durable DAG runtime tables (Phase A)
CREATE TABLE IF NOT EXISTS dag_runs (
  id TEXT PRIMARY KEY,
  dag_name TEXT NOT NULL,
  status TEXT NOT NULL,
  dag_json TEXT NOT NULL,
  run_json TEXT NOT NULL,
  trace_json TEXT DEFAULT '[]',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS dag_events (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  block_id TEXT,
  data_json TEXT DEFAULT '{}',
  timestamp TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS dag_approvals (
  token TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  block_id TEXT NOT NULL,
  status TEXT NOT NULL,
  prompt TEXT,
  approver TEXT,
  requested_at TEXT,
  decided_at TEXT,
  notes TEXT,
  payload_json TEXT DEFAULT '{}'
);

CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);
CREATE INDEX IF NOT EXISTS idx_tasks_pipeline ON tasks(pipeline);
CREATE INDEX IF NOT EXISTS idx_tasks_assigned ON tasks(assigned);
CREATE INDEX IF NOT EXISTS idx_audit_task ON audit_log(task_id);
CREATE INDEX IF NOT EXISTS idx_gate_log_task ON gate_log(task_id);
CREATE INDEX IF NOT EXISTS idx_dispatch_status ON dispatch_queue(status);
CREATE INDEX IF NOT EXISTS idx_run_events_run ON run_events(run_id);
CREATE INDEX IF NOT EXISTS idx_run_steps_run ON run_steps(run_id, step_index);
CREATE INDEX IF NOT EXISTS idx_run_idempotency_lookup ON run_step_idempotency(run_id, idempotency_key);
CREATE INDEX IF NOT EXISTS idx_dag_runs_status ON dag_runs(status);
CREATE INDEX IF NOT EXISTS idx_dag_events_run ON dag_events(run_id, timestamp);
CREATE INDEX IF NOT EXISTS idx_dag_approvals_run ON dag_approvals(run_id, status);
`;

let db: Database.Database | null = null;

export function createDB(dir: string = process.cwd()): Database.Database {
  if (db) return db;

  const dbPath = resolve(dir, ".skelo", "skelo.db");

  // Ensure .skelo directory exists
  mkdirSync(resolve(dir, ".skelo"), { recursive: true });

  db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.exec(SCHEMA);
  runMigrations(db);

  return db;
}

function runMigrations(database: Database.Database): void {
  const columns = database
    .prepare("PRAGMA table_info(runs)")
    .all() as Array<{ name?: string }>;

  const hasRunVersion = columns.some((column) => column.name === "run_version");
  if (!hasRunVersion) {
    database.exec("ALTER TABLE runs ADD COLUMN run_version INTEGER NOT NULL DEFAULT 0");
  }
}

export function getDB(): Database.Database {
  if (!db) throw new Error("Database not initialized. Call createDB() first.");
  return db;
}

export function closeDB(): void {
  if (db) {
    db.close();
    db = null;
  }
}
