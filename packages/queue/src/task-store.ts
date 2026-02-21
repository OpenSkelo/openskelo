import type Database from 'better-sqlite3'
import { ulid } from './id.js'
import {
  TaskStatus,
  applyTransition,
  type TransitionContext,
  validateTransition,
} from './state-machine.js'
import {
  deserializeTaskRow,
  parseJsonOr,
  serializeJson,
  TASK_JSON_COLUMNS,
} from './utils/serialize.js'

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
  auto_review: Record<string, unknown> | null
  parent_task_id: string | null
  loop_iteration: number
  held_by: string | null
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
  auto_review?: Record<string, unknown>
  parent_task_id?: string
  loop_iteration?: number
}

export interface InjectTaskInput extends CreateTaskInput {
  inject_before?: string
  priority_boost?: number
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

const ALLOWED_UPDATE_COLUMNS = new Set<string>([
  'type',
  'priority',
  'manual_rank',
  'summary',
  'prompt',
  'acceptance_criteria',
  'definition_of_done',
  'backend',
  'backend_config',
  'result',
  'evidence_ref',
  'lease_owner',
  'lease_expires_at',
  'attempt_count',
  'bounce_count',
  'max_attempts',
  'max_bounces',
  'last_error',
  'feedback_history',
  'depends_on',
  'pipeline_id',
  'pipeline_step',
  'gates',
  'metadata',
  'auto_review',
  'parent_task_id',
  'loop_iteration',
  'held_by',
] as const)

export interface TaskStoreConfig {
  onTransition?: (task: Task, from: TaskStatus, to: TaskStatus) => void
}

export class TaskStore {
  private db: Database.Database
  private config: TaskStoreConfig

  constructor(db: Database.Database, config?: TaskStoreConfig) {
    this.db = db
    this.config = config ?? {}
  }

  create(input: CreateTaskInput): Task {
    const id = ulid()
    const now = new Date().toISOString()
    const dependsOn = this.validateDependencies(id, input.depends_on ?? [])

    this.db.prepare(`
      INSERT INTO tasks (
        id, type, status, priority, manual_rank,
        summary, prompt, acceptance_criteria, definition_of_done,
        backend, backend_config,
        max_attempts, max_bounces,
        depends_on, pipeline_id, pipeline_step,
        gates, metadata,
        auto_review, parent_task_id, loop_iteration,
        created_at, updated_at
      ) VALUES (
        ?, ?, ?, ?, ?,
        ?, ?, ?, ?,
        ?, ?,
        ?, ?,
        ?, ?, ?,
        ?, ?,
        ?, ?, ?,
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
      serializeJson(dependsOn),
      input.pipeline_id ?? null,
      input.pipeline_step ?? null,
      serializeJson(input.gates ?? []),
      serializeJson(input.metadata ?? {}),
      serializeJson(input.auto_review ?? null),
      input.parent_task_id ?? null,
      input.loop_iteration ?? 0,
      now,
      now,
    )

    return this.getById(id)!
  }

  inject(input: InjectTaskInput): Task {
    const task = this.create({
      ...input,
      priority: input.priority_boost ?? input.priority ?? 0,
    })

    if (input.inject_before) {
      const target = this.getById(input.inject_before)
      if (!target) {
        throw new Error(`inject_before target task not found: ${input.inject_before}`)
      }

      const newDeps = [...new Set([...target.depends_on, task.id])]
      this.update(target.id, { depends_on: newDeps })
    }

    return task
  }

  getById(id: string): Task | null {
    const row = this.db.prepare('SELECT * FROM tasks WHERE id = ?').get(id) as Record<string, unknown> | undefined
    if (!row) return null
    return deserializeTaskRow(row) as unknown as Task
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
    return rows.map(row => deserializeTaskRow(row) as unknown as Task)
  }

  update(id: string, fields: Partial<Task>): Task {
    return this.updateInternal(id, fields as Record<string, unknown>, { allowStatus: false })
  }

  transition(id: string, to: TaskStatus, context: TransitionContext = {}): Task {
    const tx = this.db.transaction((taskId: string, target: TaskStatus, ctx: TransitionContext) => {
      const current = this.getById(taskId)
      if (!current) {
        throw new Error(`Task ${taskId} not found`)
      }

      validateTransition(current.status, target, {
        ...ctx,
        attempt_count: current.attempt_count,
        max_attempts: current.max_attempts,
        bounce_count: current.bounce_count,
        max_bounces: current.max_bounces,
      })

      const updates = applyTransition(current, target, ctx)
      return { updated: this.updateInternal(taskId, updates, { allowStatus: true }), from: current.status }
    })

    const { updated, from } = tx.immediate(id, to, context)
    this.config.onTransition?.(updated, from, to)
    return updated
  }

  hold(taskIds: string[], heldBy: string): void {
    if (taskIds.length === 0) return
    const stmt = this.db.prepare('UPDATE tasks SET held_by = ?, updated_at = ? WHERE id = ?')
    const now = new Date().toISOString()
    const tx = this.db.transaction(() => {
      for (const id of taskIds) {
        stmt.run(heldBy, now, id)
      }
    })
    tx()
  }

  unhold(heldBy: string): number {
    const now = new Date().toISOString()
    const result = this.db.prepare(
      'UPDATE tasks SET held_by = NULL, updated_at = ? WHERE held_by = ?',
    ).run(now, heldBy)
    return result.changes
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

  private updateInternal(
    id: string,
    fields: Record<string, unknown>,
    opts: { allowStatus: boolean },
  ): Task {
    const now = new Date().toISOString()
    const sets: string[] = ['updated_at = ?']
    const params: unknown[] = [now]

    for (const [key, rawValue] of Object.entries(fields)) {
      if (key === 'id' || key === 'created_at' || key === 'updated_at') continue

      if (key === 'status' && !opts.allowStatus) {
        throw new Error('Direct status updates are not allowed. Use transition()')
      }

      if (key !== 'status' && !ALLOWED_UPDATE_COLUMNS.has(key)) {
        throw new Error(`Invalid update column: ${key}`)
      }

      let value = rawValue
      if (key === 'depends_on') {
        if (rawValue !== null && rawValue !== undefined && !Array.isArray(rawValue)) {
          throw new Error('depends_on must be an array of task ids')
        }
        value = this.validateDependencies(id, Array.isArray(rawValue) ? rawValue as string[] : [])
      }

      sets.push(`${key} = ?`)
      if ((TASK_JSON_COLUMNS as readonly string[]).includes(key)) {
        params.push(serializeJson(value))
      } else {
        params.push(value ?? null)
      }
    }

    params.push(id)
    this.db.prepare(`UPDATE tasks SET ${sets.join(', ')} WHERE id = ?`).run(...params)

    const updated = this.getById(id)
    if (!updated) throw new Error(`Task ${id} not found after update`)
    return updated
  }

  private validateDependencies(taskId: string, dependsOnInput: string[]): string[] {
    const dependsOn = [...new Set(dependsOnInput.filter(dep => typeof dep === 'string').map(dep => dep.trim()).filter(Boolean))]

    if (dependsOn.includes(taskId)) {
      throw new Error(`Task ${taskId} cannot depend on itself`)
    }

    if (dependsOn.length === 0) {
      return []
    }

    const placeholders = dependsOn.map(() => '?').join(', ')
    const rows = this.db.prepare(`SELECT id FROM tasks WHERE id IN (${placeholders})`).all(...dependsOn) as Array<{ id: string }>
    const found = new Set(rows.map(row => row.id))
    const missing = dependsOn.filter(dep => !found.has(dep))
    if (missing.length > 0) {
      throw new Error(`depends_on contains unknown task ids: ${missing.join(', ')}`)
    }

    this.assertNoDependencyCycle(taskId, dependsOn)
    return dependsOn
  }

  private assertNoDependencyCycle(taskId: string, dependsOn: string[]): void {
    const rows = this.db.prepare('SELECT id, depends_on FROM tasks').all() as Array<{
      id: string
      depends_on: string | null
    }>

    const graph = new Map<string, string[]>()
    for (const row of rows) {
      graph.set(row.id, parseJsonOr<string[]>(row.depends_on, []))
    }
    graph.set(taskId, dependsOn)

    const visiting = new Set<string>()
    const visited = new Set<string>()

    const hasCycleFrom = (node: string): boolean => {
      if (visiting.has(node)) return true
      if (visited.has(node)) return false

      visiting.add(node)
      for (const dep of graph.get(node) ?? []) {
        if (!graph.has(dep)) continue
        if (hasCycleFrom(dep)) return true
      }
      visiting.delete(node)
      visited.add(node)
      return false
    }

    if (hasCycleFrom(taskId)) {
      throw new Error(`depends_on cycle detected for task ${taskId}`)
    }
  }
}
