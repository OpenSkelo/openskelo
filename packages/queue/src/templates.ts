import type Database from 'better-sqlite3'
import { ulid } from './id.js'
import type { TaskStore, Task, CreateTaskInput } from './task-store.js'
import { createDagPipeline } from './pipeline.js'
import type { CreateDagPipelineInput } from './pipeline.js'

export interface Template {
  id: string
  name: string
  description: string
  template_type: 'task' | 'pipeline'
  definition: Record<string, unknown>
  created_at: string
  updated_at: string
}

export interface CreateTemplateInput {
  name: string
  description?: string
  template_type: 'task' | 'pipeline'
  definition: Record<string, unknown>
}

const TEMPLATE_SCHEMA = `
  CREATE TABLE IF NOT EXISTS templates (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,
    description TEXT DEFAULT '',
    template_type TEXT NOT NULL DEFAULT 'task',
    definition TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )
`

export function ensureTemplateTable(db: Database.Database): void {
  db.exec(TEMPLATE_SCHEMA)
}

function substituteVariables(
  text: string,
  variables: Record<string, string>,
): string {
  return text.replace(/\{\{([^}]+)\}\}/g, (_match, expr: string) => {
    const defaultSep = expr.indexOf(':-')
    if (defaultSep !== -1) {
      const varName = expr.slice(0, defaultSep).trim()
      const defaultValue = expr.slice(defaultSep + 2)
      return variables[varName] ?? defaultValue
    }

    const varName = expr.trim()
    const value = variables[varName]
    if (value === undefined) {
      throw new Error(`Missing template variable: {{${varName}}}`)
    }
    return value
  })
}

function deepSubstitute(
  obj: unknown,
  variables: Record<string, string>,
): unknown {
  if (typeof obj === 'string') {
    return substituteVariables(obj, variables)
  }
  if (Array.isArray(obj)) {
    return obj.map(item => deepSubstitute(item, variables))
  }
  if (obj !== null && typeof obj === 'object') {
    const result: Record<string, unknown> = {}
    for (const [key, value] of Object.entries(obj)) {
      result[key] = deepSubstitute(value, variables)
    }
    return result
  }
  return obj
}

export class TemplateStore {
  private db: Database.Database
  private taskStore: TaskStore

  constructor(db: Database.Database, taskStore: TaskStore) {
    this.db = db
    this.taskStore = taskStore
    ensureTemplateTable(db)
  }

  create(input: CreateTemplateInput): Template {
    const id = ulid()
    const now = new Date().toISOString()

    this.db.prepare(`
      INSERT INTO templates (id, name, description, template_type, definition, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      input.name,
      input.description ?? '',
      input.template_type,
      JSON.stringify(input.definition),
      now,
      now,
    )

    return this.getById(id)!
  }

  getById(id: string): Template | null {
    const row = this.db.prepare('SELECT * FROM templates WHERE id = ?').get(id) as Record<string, unknown> | undefined
    if (!row) return null
    return this.deserialize(row)
  }

  getByName(name: string): Template | null {
    const row = this.db.prepare('SELECT * FROM templates WHERE name = ?').get(name) as Record<string, unknown> | undefined
    if (!row) return null
    return this.deserialize(row)
  }

  list(): Template[] {
    const rows = this.db.prepare('SELECT * FROM templates ORDER BY created_at ASC').all() as Record<string, unknown>[]
    return rows.map(row => this.deserialize(row))
  }

  update(id: string, updates: Partial<CreateTemplateInput>): Template {
    const existing = this.getById(id)
    if (!existing) throw new Error(`Template ${id} not found`)

    const now = new Date().toISOString()
    const sets: string[] = ['updated_at = ?']
    const params: unknown[] = [now]

    if (updates.name !== undefined) {
      sets.push('name = ?')
      params.push(updates.name)
    }
    if (updates.description !== undefined) {
      sets.push('description = ?')
      params.push(updates.description)
    }
    if (updates.template_type !== undefined) {
      sets.push('template_type = ?')
      params.push(updates.template_type)
    }
    if (updates.definition !== undefined) {
      sets.push('definition = ?')
      params.push(JSON.stringify(updates.definition))
    }

    params.push(id)
    this.db.prepare(`UPDATE templates SET ${sets.join(', ')} WHERE id = ?`).run(...params)

    return this.getById(id)!
  }

  delete(id: string): boolean {
    const result = this.db.prepare('DELETE FROM templates WHERE id = ?').run(id)
    return result.changes > 0
  }

  instantiate(
    idOrName: string,
    options?: { variables?: Record<string, string>; overrides?: Record<string, unknown> },
  ): Task[] {
    const template = this.getById(idOrName) ?? this.getByName(idOrName)
    if (!template) throw new Error(`Template not found: ${idOrName}`)

    const variables = options?.variables ?? {}
    const overrides = options?.overrides ?? {}

    let definition = structuredClone(template.definition)

    // Apply variable substitution (always run to catch missing required vars)
    definition = deepSubstitute(definition, variables) as Record<string, unknown>

    // Apply overrides
    for (const [key, value] of Object.entries(overrides)) {
      definition[key] = value
    }

    if (template.template_type === 'pipeline') {
      const pipelineInput = definition as unknown as CreateDagPipelineInput
      return createDagPipeline(this.taskStore, pipelineInput, this.db)
    }

    const taskInput = definition as unknown as CreateTaskInput
    const task = this.taskStore.create(taskInput)
    return [task]
  }

  private deserialize(row: Record<string, unknown>): Template {
    return {
      id: row.id as string,
      name: row.name as string,
      description: (row.description as string) ?? '',
      template_type: row.template_type as 'task' | 'pipeline',
      definition: JSON.parse(row.definition as string),
      created_at: row.created_at as string,
      updated_at: row.updated_at as string,
    }
  }
}
