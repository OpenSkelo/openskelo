import type Database from 'better-sqlite3'
import { ulid } from './id.js'
import { TaskStatus } from './state-machine.js'

export interface Task {
  id: string
  type: string
  status: TaskStatus
  priority: number
  manual_rank: number | null
  summary: string
  prompt: string
  acceptance_criteria: string[]
  definition_of_done: string[]
  backend: string
  backend_config: Record<string, unknown> | null
  result: string | null
  evidence_ref: string | null
  lease_owner: string | null
  lease_expires_at: string | null
  attempt_count: number
  bounce_count: number
  max_attempts: number
  max_bounces: number
  last_error: string | null
  feedback_history: Array<{ what: string; where: string; fix: string }>
  depends_on: string[]
  pipeline_id: string | null
  pipeline_step: number | null
  gates: unknown[]
  metadata: Record<string, unknown>
  created_at: string
  updated_at: string
}

export interface CreateTaskInput {
  type: string
  summary: string
  prompt: string
  backend: string
  priority?: number
  manual_rank?: number | null
  acceptance_criteria?: string[]
  definition_of_done?: string[]
  backend_config?: Record<string, unknown>
  max_attempts?: number
  max_bounces?: number
  depends_on?: string[]
  pipeline_id?: string
  pipeline_step?: number
  gates?: unknown[]
  metadata?: Record<string, unknown>
}

interface ListFilters {
  status?: TaskStatus
  type?: string
  pipeline_id?: string
  limit?: number
  offset?: number
}

interface CountFilters {
  status?: TaskStatus
  type?: string
}

// JSON columns that need serialize/deserialize
const JSON_COLUMNS = [
  'acceptance_criteria',
  'definition_of_done',
  'backend_config',
  'feedback_history',
  'depends_on',
  'gates',
  'metadata',
] as const

function serializeJson(value: unknown): string | null {
  if (value === null || value === undefined) return null
  return JSON.stringify(value)
}

function deserializeTask(row: Record<string, unknown>): Task {
  return {
    ...row,
    status: row.status as TaskStatus,
    acceptance_criteria: parseJsonOr(row.acceptance_criteria as string | null, []),
    definition_of_done: parseJsonOr(row.definition_of_done as string | null, []),
    backend_config: parseJsonOr(row.backend_config as string | null, null),
    feedback_history: parseJsonOr(row.feedback_history as string | null, []),
    depends_on: parseJsonOr(row.depends_on as string | null, []),
    gates: parseJsonOr(row.gates as string | null, []),
    metadata: parseJsonOr(row.metadata as string | null, {}),
  } as unknown as Task
}

function parseJsonOr<T>(value: string | null, fallback: T): T {
  if (value === null || value === undefined) return fallback
  try {
    return JSON.parse(value) as T
  } catch {
    return fallback
  }
}

export class TaskStore {
  private db: Database.Database

  constructor(db: Database.Database) {
    this.db = db
  }

  create(input: CreateTaskInput): Task {
    const id = ulid()
    const now = new Date().toISOString()

    this.db.prepare(`
      INSERT INTO tasks (
        id, type, status, priority, manual_rank,
        summary, prompt, acceptance_criteria, definition_of_done,
        backend, backend_config,
        max_attempts, max_bounces,
        depends_on, pipeline_id, pipeline_step,
        gates, metadata,
        created_at, updated_at
      ) VALUES (
        ?, ?, ?, ?, ?,
        ?, ?, ?, ?,
        ?, ?,
        ?, ?,
        ?, ?, ?,
        ?, ?,
        ?, ?
      )
    `).run(
      id,
      input.type,
      TaskStatus.PENDING,
      input.priority ?? 0,
      input.manual_rank ?? null,
      input.summary,
      input.prompt,
      serializeJson(input.acceptance_criteria ?? []),
      serializeJson(input.definition_of_done ?? []),
      input.backend,
      serializeJson(input.backend_config ?? null),
      input.max_attempts ?? 5,
      input.max_bounces ?? 3,
      serializeJson(input.depends_on ?? []),
      input.pipeline_id ?? null,
      input.pipeline_step ?? null,
      serializeJson(input.gates ?? []),
      serializeJson(input.metadata ?? {}),
      now,
      now,
    )

    return this.getById(id)!
  }

  getById(id: string): Task | null {
    const row = this.db.prepare('SELECT * FROM tasks WHERE id = ?').get(id) as Record<string, unknown> | undefined
    if (!row) return null
    return deserializeTask(row)
  }

  list(filters?: ListFilters): Task[] {
    const conditions: string[] = []
    const params: unknown[] = []

    if (filters?.status) {
      conditions.push('status = ?')
      params.push(filters.status)
    }
    if (filters?.type) {
      conditions.push('type = ?')
      params.push(filters.type)
    }
    if (filters?.pipeline_id) {
      conditions.push('pipeline_id = ?')
      params.push(filters.pipeline_id)
    }

    let sql = 'SELECT * FROM tasks'
    if (conditions.length) {
      sql += ' WHERE ' + conditions.join(' AND ')
    }
    sql += ' ORDER BY created_at ASC'

    if (filters?.limit) {
      sql += ' LIMIT ?'
      params.push(filters.limit)
    }
    if (filters?.offset) {
      sql += ' OFFSET ?'
      params.push(filters.offset)
    }

    const rows = this.db.prepare(sql).all(...params) as Record<string, unknown>[]
    return rows.map(deserializeTask)
  }

  update(id: string, fields: Partial<Task>): Task {
    const now = new Date().toISOString()
    const sets: string[] = ['updated_at = ?']
    const params: unknown[] = [now]

    for (const [key, value] of Object.entries(fields)) {
      if (key === 'id' || key === 'created_at' || key === 'updated_at') continue

      if ((JSON_COLUMNS as readonly string[]).includes(key)) {
        sets.push(`${key} = ?`)
        params.push(serializeJson(value))
      } else {
        sets.push(`${key} = ?`)
        params.push(value ?? null)
      }
    }

    params.push(id)
    this.db.prepare(`UPDATE tasks SET ${sets.join(', ')} WHERE id = ?`).run(...params)
    return this.getById(id)!
  }

  delete(id: string): boolean {
    const result = this.db.prepare('DELETE FROM tasks WHERE id = ?').run(id)
    return result.changes > 0
  }

  count(filters?: CountFilters): number {
    const conditions: string[] = []
    const params: unknown[] = []

    if (filters?.status) {
      conditions.push('status = ?')
      params.push(filters.status)
    }
    if (filters?.type) {
      conditions.push('type = ?')
      params.push(filters.type)
    }

    let sql = 'SELECT COUNT(*) as count FROM tasks'
    if (conditions.length) {
      sql += ' WHERE ' + conditions.join(' AND ')
    }

    const row = this.db.prepare(sql).get(...params) as { count: number }
    return row.count
  }
}
