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

const VALID_TEMPLATE_TYPES = new Set(['task', 'pipeline'])

function assertTemplateType(value: string): void {
  if (!VALID_TEMPLATE_TYPES.has(value)) {
    throw new Error('template_type must be "task" or "pipeline"')
  }
}

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

export const BUILTIN_TEMPLATES: CreateTemplateInput[] = [
  {
    name: 'spec-to-ship',
    description: 'Full autonomous pipeline: spec → tasks → build → review → ship',
    template_type: 'pipeline',
    definition: {
      tasks: [
        {
          key: 'write-spec',
          type: 'strategy',
          summary: 'Write technical spec for {{feature}}',
          prompt: [
            'You are a technical strategist writing a specification.',
            '',
            '## Feature Request',
            '{{feature}}',
            '',
            '## Context',
            '{{context:-No additional context provided}}',
            '',
            '## Instructions',
            'Write a technical specification. Include:',
            '1. User stories with acceptance criteria',
            '2. Technical approach and architecture decisions',
            '3. Files to create or modify',
            '4. Test requirements',
            '5. Potential risks or edge cases',
            '',
            'Respond with ONLY a JSON object (no markdown fences):',
            '{',
            '  "user_stories": [{ "summary": "...", "acceptance_criteria": ["..."] }],',
            '  "approach": "...",',
            '  "files": ["..."],',
            '  "test_plan": "...",',
            '  "risks": ["..."]',
            '}',
          ].join('\n'),
          backend: '{{strategist_backend:-openrouter}}',
          metadata: {
            system_prompt: 'You are a senior technical strategist. Be precise and thorough. Output valid JSON only.',
          },
        },
        {
          key: 'create-tasks',
          type: 'planning',
          summary: 'Break spec into implementation tasks',
          prompt: [
            'You are a technical lead breaking a specification into implementation tasks.',
            '',
            'Read the upstream spec output carefully.',
            '',
            '## Instructions',
            'Create 1-5 self-contained implementation tasks.',
            'Each task must have a clear prompt a coding agent can execute without ambiguity.',
            '',
            'Respond with ONLY a JSON object (no markdown fences):',
            '{',
            '  "tasks": [',
            '    {',
            '      "summary": "short description",',
            '      "prompt": "detailed implementation prompt with file paths, behavior, and test requirements",',
            '      "type": "code",',
            '      "backend": "claude-code",',
            '      "acceptance_criteria": ["criterion 1", "criterion 2"]',
            '    }',
            '  ]',
            '}',
          ].join('\n'),
          backend: '{{strategist_backend:-openrouter}}',
          depends_on: ['write-spec'],
          expand: true,
          expand_config: { mode: '{{expand_mode:-sequential}}' },
          metadata: {
            system_prompt: 'You are a technical lead. Break work into atomic, testable units. Output valid JSON only.',
          },
        },
      ],
    },
  },
  {
    name: 'dual-review',
    description: 'Auto-review preset: security + code quality review with merge decision',
    template_type: 'task',
    definition: {
      auto_review: {
        strategy: 'merge_then_decide',
        reviewers: [
          {
            backend: '{{review_backend:-openrouter}}',
            model: '{{review_model:-anthropic/claude-sonnet-4-5-20250929}}',
            prompt_template: [
              'You are a security reviewer. Evaluate this task result for:',
              '- Injection vulnerabilities (SQL, XSS, command injection)',
              '- Authentication and authorization bypasses',
              '- Race conditions and concurrency issues',
              '- Data exposure and input validation gaps',
              '',
              '## Task: {{summary}}',
              '## Prompt: {{prompt}}',
              '## Result:',
              '{{result}}',
              '',
              'Respond with JSON: { "approved": true|false, "reasoning": "...", "feedback": { "what": "...", "where": "...", "fix": "..." } }',
            ].join('\n'),
          },
          {
            backend: '{{review_backend:-openrouter}}',
            model: '{{review_model:-anthropic/claude-sonnet-4-5-20250929}}',
            prompt_template: [
              'You are a code quality reviewer. Evaluate this task result for:',
              '- Correctness and edge case handling',
              '- Error handling completeness',
              '- Test coverage adequacy',
              '- Code clarity and maintainability',
              '',
              '## Task: {{summary}}',
              '## Prompt: {{prompt}}',
              '## Result:',
              '{{result}}',
              '',
              'Respond with JSON: { "approved": true|false, "reasoning": "...", "feedback": { "what": "...", "where": "...", "fix": "..." } }',
            ].join('\n'),
          },
        ],
        merge_backend: '{{merge_backend:-openrouter}}',
        max_iterations: 3,
      },
    },
  },
]

export function seedBuiltinTemplates(store: TemplateStore): number {
  let seeded = 0
  for (const tpl of BUILTIN_TEMPLATES) {
    const existing = store.getByName(tpl.name)
    if (!existing) {
      store.create(tpl)
      seeded++
    }
  }
  return seeded
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
    assertTemplateType(input.template_type)

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
      assertTemplateType(updates.template_type)
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
    options?: {
      variables?: Record<string, string>
      overrides?: Record<string, unknown>
      auto_review?: Record<string, unknown>
    },
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
      if (options?.auto_review && Array.isArray(pipelineInput.tasks)) {
        for (const node of pipelineInput.tasks) {
          const n = node as unknown as Record<string, unknown>
          if (!n.auto_review) {
            n.auto_review = options.auto_review
          }
        }
      }
      return createDagPipeline(this.taskStore, pipelineInput, this.db)
    }

    const taskInput = definition as unknown as CreateTaskInput
    if (options?.auto_review && !taskInput.auto_review) {
      taskInput.auto_review = options.auto_review
    }
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
