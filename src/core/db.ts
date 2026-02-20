import Database from "better-sqlite3";
import { resolve } from "path";
import { mkdirSync } from "fs";

const BASE_SCHEMA = `
CREATE TABLE IF NOT EXISTS schema_migrations (
  id TEXT PRIMARY KEY,
  applied_at TEXT NOT NULL DEFAULT (datetime('now'))
);
`;

const MIGRATIONS: Array<{ id: string; sql: string }> = [
  {
    id: "001_dag_runtime_core",
    sql: `
      -- Durable DAG runtime tables (canonical)
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

      CREATE INDEX IF NOT EXISTS idx_dag_runs_status ON dag_runs(status);
      CREATE INDEX IF NOT EXISTS idx_dag_events_run ON dag_events(run_id, timestamp);
      CREATE INDEX IF NOT EXISTS idx_dag_approvals_run ON dag_approvals(run_id, status);
    `,
  },
  {
    id: "002_dag_run_queue_control_plane",
    sql: `
      CREATE TABLE IF NOT EXISTS dag_run_queue (
        run_id TEXT PRIMARY KEY,
        status TEXT NOT NULL,
        priority INTEGER NOT NULL DEFAULT 0,
        manual_rank INTEGER,
        claim_owner TEXT,
        claim_token TEXT,
        lease_expires_at TEXT,
        attempt INTEGER NOT NULL DEFAULT 0,
        payload_json TEXT NOT NULL,
        last_error TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        started_at TEXT,
        finished_at TEXT
      );

      CREATE INDEX IF NOT EXISTS idx_dag_run_queue_status_order
        ON dag_run_queue(status, manual_rank, priority, created_at);
      CREATE INDEX IF NOT EXISTS idx_dag_run_queue_lease
        ON dag_run_queue(status, lease_expires_at);
    `,
  },
];

let db: Database.Database | null = null;

export function createDB(dir: string = process.cwd()): Database.Database {
  if (db) return db;

  const dbPath = resolve(dir, ".skelo", "skelo.db");

  // Ensure .skelo directory exists
  mkdirSync(resolve(dir, ".skelo"), { recursive: true });

  db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");

  db.exec(BASE_SCHEMA);
  applyMigrations(db);

  return db;
}

function applyMigrations(database: Database.Database): void {
  const selectApplied = database.prepare("SELECT id FROM schema_migrations");
  const insertApplied = database.prepare("INSERT INTO schema_migrations (id, applied_at) VALUES (?, datetime('now'))");

  const applied = new Set((selectApplied.all() as Array<{ id: string }>).map((r) => r.id));

  for (const migration of MIGRATIONS) {
    if (applied.has(migration.id)) continue;
    const tx = database.transaction(() => {
      database.exec(migration.sql);
      insertApplied.run(migration.id);
    });
    tx();
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
