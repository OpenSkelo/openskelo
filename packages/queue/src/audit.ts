import type Database from 'better-sqlite3'
import { ulid } from './id.js'

export interface AuditEntry {
  id: string
  task_id: string
  action: string
  actor: string | null
  before_state: string | null
  after_state: string | null
  metadata: Record<string, unknown> | null
  created_at: string
}

interface LogActionInput {
  task_id: string
  action: string
  actor?: string
  before_state?: string
  after_state?: string
  metadata?: Record<string, unknown>
}

interface GetLogOptions {
  task_id?: string
  limit?: number
  offset?: number
}

function deserializeEntry(row: Record<string, unknown>): AuditEntry {
  return {
    ...row,
    metadata: row.metadata
      ? JSON.parse(row.metadata as string)
      : null,
  } as AuditEntry
}

export class AuditLog {
  private db: Database.Database

  constructor(db: Database.Database) {
    this.db = db
  }

  logAction(input: LogActionInput): AuditEntry {
    const id = ulid()
    const now = new Date().toISOString()

    this.db.prepare(`
      INSERT INTO audit_log (id, task_id, action, actor, before_state, after_state, metadata, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      input.task_id,
      input.action,
      input.actor ?? null,
      input.before_state ?? null,
      input.after_state ?? null,
      input.metadata ? JSON.stringify(input.metadata) : null,
      now,
    )

    return this.getById(id)!
  }

  getLog(opts?: GetLogOptions): AuditEntry[] {
    const conditions: string[] = []
    const params: unknown[] = []

    if (opts?.task_id) {
      conditions.push('task_id = ?')
      params.push(opts.task_id)
    }

    let sql = 'SELECT * FROM audit_log'
    if (conditions.length) {
      sql += ' WHERE ' + conditions.join(' AND ')
    }
    sql += ' ORDER BY id ASC'

    if (opts?.limit) {
      sql += ' LIMIT ?'
      params.push(opts.limit)
    }
    if (opts?.offset) {
      sql += ' OFFSET ?'
      params.push(opts.offset)
    }

    const rows = this.db.prepare(sql).all(...params) as Record<string, unknown>[]
    return rows.map(deserializeEntry)
  }

  getTaskHistory(task_id: string): AuditEntry[] {
    return this.getLog({ task_id })
  }

  private getById(id: string): AuditEntry | null {
    const row = this.db.prepare('SELECT * FROM audit_log WHERE id = ?').get(id) as Record<string, unknown> | undefined
    if (!row) return null
    return deserializeEntry(row)
  }
}
