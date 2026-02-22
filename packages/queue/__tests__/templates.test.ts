import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { createDatabase } from '../src/db.js'
import { TaskStore } from '../src/task-store.js'
import { TemplateStore, BUILTIN_TEMPLATES, seedBuiltinTemplates } from '../src/templates.js'
import type Database from 'better-sqlite3'

describe('TemplateStore', () => {
  let db: Database.Database
  let taskStore: TaskStore
  let templateStore: TemplateStore

  beforeEach(() => {
    db = createDatabase(':memory:')
    taskStore = new TaskStore(db)
    templateStore = new TemplateStore(db, taskStore)
  })

  afterEach(() => {
    db.close()
  })

  const taskDef = {
    type: 'code',
    summary: 'Fix bug',
    prompt: 'Fix the login bug',
    backend: 'claude-code',
  }

  const pipelineDef = {
    tasks: [
      { key: 'a', type: 'code', summary: 'A', prompt: 'Do A', backend: 'claude-code' },
      { key: 'b', type: 'code', summary: 'B', prompt: 'Do B', backend: 'claude-code', depends_on: ['a'] },
    ],
  }

  it('creates task template and stores correctly', () => {
    const tpl = templateStore.create({
      name: 'fix-bug',
      template_type: 'task',
      definition: taskDef,
    })
    expect(tpl.id).toBeTruthy()
    expect(tpl.name).toBe('fix-bug')
    expect(tpl.template_type).toBe('task')
    expect(tpl.definition).toEqual(taskDef)
    expect(tpl.created_at).toBeTruthy()
  })

  it('creates pipeline template and stores correctly', () => {
    const tpl = templateStore.create({
      name: 'review-pipeline',
      template_type: 'pipeline',
      definition: pipelineDef,
    })
    expect(tpl.template_type).toBe('pipeline')
    expect(tpl.definition).toEqual(pipelineDef)
  })

  it('rejects duplicate name', () => {
    templateStore.create({ name: 'dup', template_type: 'task', definition: taskDef })
    expect(() => templateStore.create({ name: 'dup', template_type: 'task', definition: taskDef }))
      .toThrow()
  })

  it('TemplateStore.create rejects invalid template_type', () => {
    expect(() => {
      templateStore.create({
        name: 'bad-type',
        template_type: 'weird' as unknown as 'task',
        definition: taskDef,
      })
    }).toThrow('template_type must be "task" or "pipeline"')
  })

  it('getByName returns correct template', () => {
    templateStore.create({ name: 'my-tpl', template_type: 'task', definition: taskDef })
    const found = templateStore.getByName('my-tpl')
    expect(found).not.toBeNull()
    expect(found!.name).toBe('my-tpl')
  })

  it('getByName returns null for missing', () => {
    expect(templateStore.getByName('nonexistent')).toBeNull()
  })

  it('list returns all templates', () => {
    templateStore.create({ name: 'tpl-1', template_type: 'task', definition: taskDef })
    templateStore.create({ name: 'tpl-2', template_type: 'task', definition: taskDef })
    const list = templateStore.list()
    expect(list).toHaveLength(2)
  })

  it('update changes fields', () => {
    const tpl = templateStore.create({ name: 'old-name', template_type: 'task', definition: taskDef })
    const updated = templateStore.update(tpl.id, {
      name: 'new-name',
      description: 'Updated description',
    })
    expect(updated.name).toBe('new-name')
    expect(updated.description).toBe('Updated description')
  })

  it('delete removes template', () => {
    const tpl = templateStore.create({ name: 'to-delete', template_type: 'task', definition: taskDef })
    expect(templateStore.delete(tpl.id)).toBe(true)
    expect(templateStore.getById(tpl.id)).toBeNull()
  })

  it('delete returns false for missing', () => {
    expect(templateStore.delete('nonexistent')).toBe(false)
  })

  it('instantiate task template creates task with correct fields', () => {
    templateStore.create({ name: 'task-tpl', template_type: 'task', definition: taskDef })
    const tasks = templateStore.instantiate('task-tpl')
    expect(tasks).toHaveLength(1)
    expect(tasks[0].type).toBe('code')
    expect(tasks[0].summary).toBe('Fix bug')
    expect(tasks[0].prompt).toBe('Fix the login bug')
    expect(tasks[0].backend).toBe('claude-code')
  })

  it('instantiate pipeline template creates pipeline tasks', () => {
    templateStore.create({ name: 'pipe-tpl', template_type: 'pipeline', definition: pipelineDef })
    const tasks = templateStore.instantiate('pipe-tpl')
    expect(tasks).toHaveLength(2)
    expect(tasks[0].pipeline_id).toBeTruthy()
    expect(tasks[1].depends_on).toContain(tasks[0].id)
  })

  it('variable substitution: {{var}} replaced correctly', () => {
    const defWithVars = {
      type: 'code',
      summary: 'Review {{module}} for issues',
      prompt: 'Analyze {{file_path}}',
      backend: 'claude-code',
    }
    templateStore.create({ name: 'var-tpl', template_type: 'task', definition: defWithVars })
    const tasks = templateStore.instantiate('var-tpl', {
      variables: { module: 'auth', file_path: 'src/auth.ts' },
    })
    expect(tasks[0].summary).toBe('Review auth for issues')
    expect(tasks[0].prompt).toBe('Analyze src/auth.ts')
  })

  it('variable substitution: missing variable throws', () => {
    const defWithVars = {
      type: 'code',
      summary: 'Review {{module}}',
      prompt: 'Do it',
      backend: 'claude-code',
    }
    templateStore.create({ name: 'missing-var', template_type: 'task', definition: defWithVars })
    expect(() => templateStore.instantiate('missing-var'))
      .toThrow('Missing template variable: {{module}}')
  })

  it('variable substitution: {{var:-default}} uses default when not provided', () => {
    const defWithDefaults = {
      type: 'code',
      summary: 'Review {{module:-core}} module',
      prompt: 'Check {{focus:-all}}',
      backend: 'claude-code',
    }
    templateStore.create({ name: 'default-var', template_type: 'task', definition: defWithDefaults })
    const tasks = templateStore.instantiate('default-var')
    expect(tasks[0].summary).toBe('Review core module')
    expect(tasks[0].prompt).toBe('Check all')
  })

  it('overrides merge with definition (override wins)', () => {
    templateStore.create({ name: 'override-tpl', template_type: 'task', definition: taskDef })
    const tasks = templateStore.instantiate('override-tpl', {
      overrides: { summary: 'Overridden summary', priority: 5 },
    })
    expect(tasks[0].summary).toBe('Overridden summary')
    expect(tasks[0].priority).toBe(5)
  })

  it('instantiate by id works', () => {
    const tpl = templateStore.create({ name: 'by-id', template_type: 'task', definition: taskDef })
    const tasks = templateStore.instantiate(tpl.id)
    expect(tasks).toHaveLength(1)
  })

  it('instantiate throws for missing template', () => {
    expect(() => templateStore.instantiate('nonexistent'))
      .toThrow('Template not found: nonexistent')
  })

  it('instantiate with auto_review applies to task template', () => {
    templateStore.create({ name: 'ar-task', template_type: 'task', definition: taskDef })
    const autoReview = { reviewers: [{ backend: 'openrouter' }], strategy: 'all_must_approve' }
    const tasks = templateStore.instantiate('ar-task', { auto_review: autoReview })
    expect(tasks[0].auto_review).toEqual(autoReview)
  })

  it('instantiate with auto_review applies to pipeline tasks', () => {
    templateStore.create({ name: 'ar-pipe', template_type: 'pipeline', definition: pipelineDef })
    const autoReview = { reviewers: [{ backend: 'openrouter' }], strategy: 'any_approve' }
    const tasks = templateStore.instantiate('ar-pipe', { auto_review: autoReview })
    expect(tasks).toHaveLength(2)
    expect(tasks[0].auto_review).toEqual(autoReview)
    expect(tasks[1].auto_review).toEqual(autoReview)
  })
})

describe('BUILTIN_TEMPLATES', () => {
  it('contains spec-to-ship and dual-review', () => {
    const names = BUILTIN_TEMPLATES.map(t => t.name)
    expect(names).toContain('spec-to-ship')
    expect(names).toContain('dual-review')
  })

  it('spec-to-ship is a pipeline template with write-spec and create-tasks', () => {
    const specToShip = BUILTIN_TEMPLATES.find(t => t.name === 'spec-to-ship')!
    expect(specToShip.template_type).toBe('pipeline')
    const def = specToShip.definition as { tasks: Array<Record<string, unknown>> }
    expect(def.tasks).toHaveLength(2)
    expect(def.tasks[0].key).toBe('write-spec')
    expect(def.tasks[1].key).toBe('create-tasks')
  })

  it('spec-to-ship write-spec task has structured JSON output instruction', () => {
    const specToShip = BUILTIN_TEMPLATES.find(t => t.name === 'spec-to-ship')!
    const def = specToShip.definition as { tasks: Array<Record<string, unknown>> }
    const writeSpec = def.tasks[0]
    expect(writeSpec.prompt).toContain('user_stories')
    expect((writeSpec.metadata as Record<string, unknown>).system_prompt).toBeDefined()
  })

  it('spec-to-ship create-tasks has expand: true', () => {
    const specToShip = BUILTIN_TEMPLATES.find(t => t.name === 'spec-to-ship')!
    const def = specToShip.definition as { tasks: Array<Record<string, unknown>> }
    const createTasks = def.tasks[1]
    expect(createTasks.expand).toBe(true)
    expect(createTasks.depends_on).toEqual(['write-spec'])
  })

  it('dual-review has two reviewers with prompt_template and merge_backend', () => {
    const dualReview = BUILTIN_TEMPLATES.find(t => t.name === 'dual-review')!
    expect(dualReview.template_type).toBe('task')
    const def = dualReview.definition as { auto_review: Record<string, unknown> }
    expect(def.auto_review.strategy).toBe('merge_then_decide')
    const reviewers = def.auto_review.reviewers as Array<Record<string, unknown>>
    expect(reviewers).toHaveLength(2)
    expect(def.auto_review.merge_backend).toBeDefined()
    // Both reviewers have prompt_template
    for (const reviewer of reviewers) {
      expect(reviewer.prompt_template).toBeDefined()
      expect(typeof reviewer.prompt_template).toBe('string')
    }
  })

  it('dual-review reviewers have structured output instruction in prompt_template', () => {
    const dualReview = BUILTIN_TEMPLATES.find(t => t.name === 'dual-review')!
    const def = dualReview.definition as { auto_review: Record<string, unknown> }
    const reviewers = def.auto_review.reviewers as Array<Record<string, unknown>>
    // First reviewer is security, second is code quality
    expect(reviewers[0].prompt_template).toContain('security reviewer')
    expect(reviewers[1].prompt_template).toContain('code quality reviewer')
    for (const reviewer of reviewers) {
      expect(reviewer.prompt_template).toContain('approved')
    }
  })
})

describe('seedBuiltinTemplates', () => {
  let db: Database.Database
  let taskStore: TaskStore
  let templateStore: TemplateStore

  beforeEach(() => {
    db = createDatabase(':memory:')
    taskStore = new TaskStore(db)
    templateStore = new TemplateStore(db, taskStore)
  })

  afterEach(() => {
    db.close()
  })

  it('seeds all builtin templates', () => {
    const seeded = seedBuiltinTemplates(templateStore)
    expect(seeded).toBe(BUILTIN_TEMPLATES.length)
    expect(templateStore.getByName('spec-to-ship')).not.toBeNull()
    expect(templateStore.getByName('dual-review')).not.toBeNull()
  })

  it('is idempotent — skips existing templates', () => {
    seedBuiltinTemplates(templateStore)
    const secondRun = seedBuiltinTemplates(templateStore)
    expect(secondRun).toBe(0)
    expect(templateStore.list().length).toBe(BUILTIN_TEMPLATES.length)
  })

  it('seeds only missing templates', () => {
    templateStore.create({
      name: 'spec-to-ship',
      template_type: 'task',
      definition: { type: 'custom' },
    })
    const seeded = seedBuiltinTemplates(templateStore)
    expect(seeded).toBe(BUILTIN_TEMPLATES.length - 1)
  })

  it('seeded spec-to-ship can be instantiated with variables', () => {
    seedBuiltinTemplates(templateStore)
    const tasks = templateStore.instantiate('spec-to-ship', {
      variables: { feature: 'user-auth' },
    })
    expect(tasks.length).toBeGreaterThanOrEqual(2)
    expect(tasks[0].summary).toContain('user-auth')
  })
})
