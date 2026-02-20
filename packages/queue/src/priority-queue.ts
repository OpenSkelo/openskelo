import type Database from 'better-sqlite3'
import type { Task } from './task-store.js'
import { TaskStatus } from './state-machine.js'

interface GetNextOptions {
  type?: string
  excludeIds?: string[]
}

type ReorderPosition =
  | { top: true }
  | { before: string }
  | { after: string }

// JSON columns that need deserialization
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

export class PriorityQueue {
  private db: Database.Database

  constructor(db: Database.Database) {
    this.db = db
  }

  getNext(opts?: GetNextOptions): Task | null {
    const conditions = ["status = 'PENDING'"]
    const params: unknown[] = []

    if (opts?.type) {
      conditions.push('type = ?')
      params.push(opts.type)
    }

    if (opts?.excludeIds?.length) {
      const placeholders = opts.excludeIds.map(() => '?').join(', ')
      conditions.push(`id NOT IN (${placeholders})`)
      params.push(...opts.excludeIds)
    }

    const sql = `
      SELECT * FROM tasks
      WHERE ${conditions.join(' AND ')}
      ORDER BY
        priority ASC,
        CASE WHEN manual_rank IS NULL THEN 1 ELSE 0 END,
        manual_rank ASC,
        created_at ASC,
        id ASC
      LIMIT 1
    `

    const row = this.db.prepare(sql).get(...params) as Record<string, unknown> | undefined
    if (!row) return null
    return deserializeTask(row)
  }

  reorder(id: string, position: ReorderPosition): void {
    if ('top' in position) {
      const min = this.db.prepare(
        "SELECT MIN(manual_rank) as min_rank FROM tasks WHERE status = 'PENDING'"
      ).get() as { min_rank: number | null }
      const newRank = min.min_rank !== null ? min.min_rank - 1 : 0
      this.db.prepare('UPDATE tasks SET manual_rank = ? WHERE id = ?').run(newRank, id)
    } else if ('before' in position) {
      const target = this.db.prepare(
        'SELECT manual_rank FROM tasks WHERE id = ?'
      ).get(position.before) as { manual_rank: number | null } | undefined
      if (!target) throw new Error(`Task ${position.before} not found`)
      const targetRank = target.manual_rank ?? 0
      this.db.prepare('UPDATE tasks SET manual_rank = ? WHERE id = ?').run(targetRank - 0.5, id)
    } else {
      const target = this.db.prepare(
        'SELECT manual_rank FROM tasks WHERE id = ?'
      ).get(position.after) as { manual_rank: number | null } | undefined
      if (!target) throw new Error(`Task ${position.after} not found`)
      const targetRank = target.manual_rank ?? 0
      this.db.prepare('UPDATE tasks SET manual_rank = ? WHERE id = ?').run(targetRank + 0.5, id)
    }
  }
}
