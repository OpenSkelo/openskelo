import Database from 'better-sqlite3'

export function createDatabase(path: string): Database.Database {
  const db = new Database(path)

  // Enable WAL mode for concurrent reads
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')

  db.exec(SCHEMA)

  return db
}

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS tasks (
    id                  TEXT PRIMARY KEY,
    type                TEXT NOT NULL,
    status              TEXT NOT NULL DEFAULT 'PENDING',
    priority            INTEGER NOT NULL DEFAULT 0,
    manual_rank         REAL,
    summary             TEXT NOT NULL,
    prompt              TEXT NOT NULL,
    acceptance_criteria TEXT,
    definition_of_done  TEXT,
    backend             TEXT NOT NULL,
    backend_config      TEXT,
    result              TEXT,
    evidence_ref        TEXT,
    lease_owner         TEXT,
    lease_expires_at    TEXT,
    attempt_count       INTEGER NOT NULL DEFAULT 0,
    bounce_count        INTEGER NOT NULL DEFAULT 0,
    max_attempts        INTEGER NOT NULL DEFAULT 5,
    max_bounces         INTEGER NOT NULL DEFAULT 3,
    last_error          TEXT,
    feedback_history    TEXT,
    depends_on          TEXT,
    pipeline_id         TEXT,
    pipeline_step       INTEGER,
    gates               TEXT,
    metadata            TEXT,
    created_at          TEXT NOT NULL,
    updated_at          TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_queue_order
    ON tasks (status, priority DESC, manual_rank ASC, created_at ASC)
    WHERE status = 'PENDING';

  CREATE INDEX IF NOT EXISTS idx_lease_expiry
    ON tasks (lease_expires_at)
    WHERE lease_owner IS NOT NULL;

  CREATE INDEX IF NOT EXISTS idx_pipeline
    ON tasks (pipeline_id, pipeline_step)
    WHERE pipeline_id IS NOT NULL;

  CREATE TABLE IF NOT EXISTS audit_log (
    id          TEXT PRIMARY KEY,
    task_id     TEXT NOT NULL,
    action      TEXT NOT NULL,
    actor       TEXT,
    before_state TEXT,
    after_state TEXT,
    metadata    TEXT,
    created_at  TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_audit_task
    ON audit_log (task_id, created_at);
`
