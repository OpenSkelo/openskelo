import Database from "better-sqlite3";
import { resolve } from "path";

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

CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);
CREATE INDEX IF NOT EXISTS idx_tasks_pipeline ON tasks(pipeline);
CREATE INDEX IF NOT EXISTS idx_tasks_assigned ON tasks(assigned);
CREATE INDEX IF NOT EXISTS idx_audit_task ON audit_log(task_id);
CREATE INDEX IF NOT EXISTS idx_gate_log_task ON gate_log(task_id);
CREATE INDEX IF NOT EXISTS idx_dispatch_status ON dispatch_queue(status);
`;

let db: Database.Database | null = null;

export function createDB(dir: string = process.cwd()): Database.Database {
  if (db) return db;

  const dbPath = resolve(dir, ".skelo", "skelo.db");

  // Ensure .skelo directory exists
  const { mkdirSync } = require("fs");
  mkdirSync(resolve(dir, ".skelo"), { recursive: true });

  db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.exec(SCHEMA);

  return db;
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
