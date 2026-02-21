import type Database from 'better-sqlite3'
import type { Task } from './task-store.js'
import { deserializeTaskRow } from './utils/serialize.js'

interface GetNextOptions {
  type?: string
  excludeIds?: string[]
}

type ReorderPosition =
  | { top: true }
  | { before: string }
  | { after: string }

export class PriorityQueue {
  private db: Database.Database

  constructor(db: Database.Database) {
    this.db = db
  }

  getNext(opts?: GetNextOptions): Task | null {
    const conditions = ["status = 'PENDING'", 'held_by IS NULL']
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
    return deserializeTaskRow(row) as unknown as Task
  }

  reorder(id: string, position: ReorderPosition): void {
    const tx = this.db.transaction((taskId: string, nextPosition: ReorderPosition) => {
      const rows = this.db.prepare(`
        SELECT id
        FROM tasks
        WHERE status = 'PENDING'
        ORDER BY
          priority ASC,
          CASE WHEN manual_rank IS NULL THEN 1 ELSE 0 END,
          manual_rank ASC,
          created_at ASC,
          id ASC
      `).all() as Array<{ id: string }>

      const orderedIds = rows.map(row => row.id)
      const currentIndex = orderedIds.indexOf(taskId)
      if (currentIndex === -1) {
        throw new Error(`Task ${taskId} not found in PENDING queue`)
      }

      orderedIds.splice(currentIndex, 1)

      let insertIndex = 0
      if ('top' in nextPosition) {
        insertIndex = 0
      } else if ('before' in nextPosition) {
        const targetIndex = orderedIds.indexOf(nextPosition.before)
        if (targetIndex === -1) {
          throw new Error(`Task ${nextPosition.before} not found in PENDING queue`)
        }
        insertIndex = targetIndex
      } else {
        const targetIndex = orderedIds.indexOf(nextPosition.after)
        if (targetIndex === -1) {
          throw new Error(`Task ${nextPosition.after} not found in PENDING queue`)
        }
        insertIndex = targetIndex + 1
      }

      orderedIds.splice(insertIndex, 0, taskId)

      const updateRank = this.db.prepare('UPDATE tasks SET manual_rank = ? WHERE id = ?')
      for (const [rank, rowId] of orderedIds.entries()) {
        updateRank.run(rank, rowId)
      }
    })

    tx.immediate(id, position)
  }
}
