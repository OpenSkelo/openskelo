import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { createDatabase } from '../src/db.js'
import { TaskStore } from '../src/task-store.js'
import { AuditLog } from '../src/audit.js'
import { ExpandHandler, parseExpandOutput } from '../src/expand-handler.js'
import { TaskStatus } from '../src/state-machine.js'
import type Database from 'better-sqlite3'

describe('parseExpandOutput', () => {
  it('parses valid JSON array', () => {
    const input = JSON.stringify([
      { type: 'code', summary: 'Task A', prompt: 'Do A', backend: 'claude-code' },
      { type: 'code', summary: 'Task B', prompt: 'Do B', backend: 'claude-code' },
    ])
    const result = parseExpandOutput(input)
    expect(result).toHaveLength(2)
    expect(result[0].type).toBe('code')
    expect(result[1].summary).toBe('Task B')
  })

  it('parses JSON object with tasks field', () => {
    const input = JSON.stringify({
      tasks: [
        { type: 'code', summary: 'A', prompt: 'Do A', backend: 'cc' },
      ],
    })
    const result = parseExpandOutput(input)
    expect(result).toHaveLength(1)
    expect(result[0].backend).toBe('cc')
  })

  it('extracts JSON from markdown code block', () => {
    const input = 'Here is the result:\n```json\n[{"type":"code","summary":"A","prompt":"P","backend":"cc"}]\n```\nDone.'
    const result = parseExpandOutput(input)
    expect(result).toHaveLength(1)
    expect(result[0].type).toBe('code')
  })

  it('rejects non-JSON input', () => {
    expect(() => parseExpandOutput('not json at all')).toThrow('not valid JSON')
  })

  it('rejects non-array, non-object-with-tasks', () => {
    expect(() => parseExpandOutput('"just a string"')).toThrow('must be an array')
  })

  it('rejects empty array', () => {
    expect(() => parseExpandOutput('[]')).toThrow('contains no tasks')
  })

  it('rejects exceeding 20 task cap', () => {
    const tasks = Array.from({ length: 21 }, (_, i) => ({
      type: 'code',
      summary: `Task ${i}`,
      prompt: `Do ${i}`,
      backend: 'cc',
    }))
    expect(() => parseExpandOutput(JSON.stringify(tasks))).toThrow('exceeds 20 task cap')
  })

  it('rejects tasks missing required fields', () => {
    const input = JSON.stringify([{ type: 'code', summary: 'A' }])
    expect(() => parseExpandOutput(input)).toThrow('missing required fields')
  })

  it('preserves optional fields', () => {
    const input = JSON.stringify([{
      type: 'code',
      summary: 'A',
      prompt: 'P',
      backend: 'cc',
      priority: 5,
      acceptance_criteria: ['works'],
      definition_of_done: ['tested'],
      metadata: { custom: true },
    }])
    const result = parseExpandOutput(input)
    expect(result[0].priority).toBe(5)
    expect(result[0].acceptance_criteria).toEqual(['works'])
    expect(result[0].definition_of_done).toEqual(['tested'])
    expect(result[0].metadata).toEqual({ custom: true })
  })
})

describe('ExpandHandler', () => {
  let db: Database.Database
  let taskStore: TaskStore
  let auditLog: AuditLog
  let handler: ExpandHandler

  beforeEach(() => {
    db = createDatabase(':memory:')
    taskStore = new TaskStore(db)
    auditLog = new AuditLog(db)
    handler = new ExpandHandler(taskStore, auditLog)
  })

  afterEach(() => {
    db.close()
  })

  function createExpandTask(opts?: {
    result?: string
    mode?: string
    pipelineId?: string
    pipelineStep?: number
    auto_review?: Record<string, unknown>
  }) {
    const task = taskStore.create({
      type: 'spec',
      summary: 'Generate tasks',
      prompt: 'Create implementation plan',
      backend: 'claude-code',
      pipeline_id: opts?.pipelineId,
      pipeline_step: opts?.pipelineStep ?? 0,
      metadata: {
        expand: true,
        expand_config: { mode: opts?.mode ?? 'sequential' },
      },
      auto_review: opts?.auto_review,
    })
    const resultVal = opts?.result ?? 'placeholder'
    taskStore.transition(task.id, TaskStatus.IN_PROGRESS, { lease_owner: 'test' })
    taskStore.transition(task.id, TaskStatus.REVIEW, { result: resultVal })
    taskStore.transition(task.id, TaskStatus.DONE)
    return taskStore.getById(task.id)!
  }

  it('creates expanded tasks in sequential mode', () => {
    const result = JSON.stringify([
      { type: 'code', summary: 'Step 1', prompt: 'Do 1', backend: 'cc' },
      { type: 'code', summary: 'Step 2', prompt: 'Do 2', backend: 'cc' },
      { type: 'code', summary: 'Step 3', prompt: 'Do 3', backend: 'cc' },
    ])
    const task = createExpandTask({ result })
    handler.onExpandComplete(task)

    const children = taskStore.list({}).filter(
      t => t.parent_task_id === task.id,
    )
    expect(children).toHaveLength(3)
    expect(children[0].summary).toBe('Step 1')
    expect(children[0].depends_on).toEqual([])
    expect(children[1].depends_on).toContain(children[0].id)
    expect(children[2].depends_on).toContain(children[1].id)
  })

  it('creates expanded tasks in parallel mode', () => {
    const result = JSON.stringify([
      { type: 'code', summary: 'A', prompt: 'Do A', backend: 'cc' },
      { type: 'code', summary: 'B', prompt: 'Do B', backend: 'cc' },
    ])
    const task = createExpandTask({ result, mode: 'parallel' })
    handler.onExpandComplete(task)

    const children = taskStore.list({}).filter(
      t => t.parent_task_id === task.id,
    )
    expect(children).toHaveLength(2)
    expect(children[0].depends_on).toEqual([])
    expect(children[1].depends_on).toEqual([])
  })

  it('sets expanded_from and expand_index metadata', () => {
    const result = JSON.stringify([
      { type: 'code', summary: 'A', prompt: 'P', backend: 'cc' },
      { type: 'code', summary: 'B', prompt: 'P', backend: 'cc' },
    ])
    const task = createExpandTask({ result })
    handler.onExpandComplete(task)

    const children = taskStore.list({}).filter(
      t => t.parent_task_id === task.id,
    )
    expect(children[0].metadata.expanded_from).toBe(task.id)
    expect(children[0].metadata.expand_index).toBe(0)
    expect(children[1].metadata.expand_index).toBe(1)
  })

  it('rewires downstream dependencies in sequential mode', () => {
    const pipelineId = 'pipe-1'
    // Create expand task
    const expandTask = taskStore.create({
      type: 'spec',
      summary: 'Spec',
      prompt: 'Spec it',
      backend: 'cc',
      pipeline_id: pipelineId,
      pipeline_step: 0,
      metadata: { expand: true, expand_config: { mode: 'sequential' } },
    })
    // Create downstream task that depends on expand task
    const downstream = taskStore.create({
      type: 'test',
      summary: 'Test',
      prompt: 'Test it',
      backend: 'cc',
      pipeline_id: pipelineId,
      pipeline_step: 1,
      depends_on: [expandTask.id],
    })

    // Complete the expand task
    const resultJson = JSON.stringify([
      { type: 'code', summary: 'Impl 1', prompt: 'P1', backend: 'cc' },
      { type: 'code', summary: 'Impl 2', prompt: 'P2', backend: 'cc' },
    ])
    taskStore.transition(expandTask.id, TaskStatus.IN_PROGRESS, { lease_owner: 'test' })
    taskStore.transition(expandTask.id, TaskStatus.REVIEW, { result: resultJson })
    taskStore.transition(expandTask.id, TaskStatus.DONE)

    const doneTask = taskStore.getById(expandTask.id)!
    handler.onExpandComplete(doneTask)

    // Downstream should now depend on the LAST expanded task, not the expand task
    const updatedDownstream = taskStore.getById(downstream.id)!
    const children = taskStore.list({}).filter(
      t => t.parent_task_id === expandTask.id,
    )
    expect(updatedDownstream.depends_on).not.toContain(expandTask.id)
    expect(updatedDownstream.depends_on).toContain(children[children.length - 1].id)
  })

  it('rewires downstream dependencies in parallel mode', () => {
    const pipelineId = 'pipe-2'
    const expandTask = taskStore.create({
      type: 'spec',
      summary: 'Spec',
      prompt: 'Spec it',
      backend: 'cc',
      pipeline_id: pipelineId,
      pipeline_step: 0,
      metadata: { expand: true, expand_config: { mode: 'parallel' } },
    })
    const downstream = taskStore.create({
      type: 'test',
      summary: 'Test',
      prompt: 'Test it',
      backend: 'cc',
      pipeline_id: pipelineId,
      pipeline_step: 1,
      depends_on: [expandTask.id],
    })

    const resultJson = JSON.stringify([
      { type: 'code', summary: 'A', prompt: 'PA', backend: 'cc' },
      { type: 'code', summary: 'B', prompt: 'PB', backend: 'cc' },
    ])
    taskStore.transition(expandTask.id, TaskStatus.IN_PROGRESS, { lease_owner: 'test' })
    taskStore.transition(expandTask.id, TaskStatus.REVIEW, { result: resultJson })
    taskStore.transition(expandTask.id, TaskStatus.DONE)

    handler.onExpandComplete(taskStore.getById(expandTask.id)!)

    // Downstream should depend on ALL expanded tasks
    const updatedDownstream = taskStore.getById(downstream.id)!
    const children = taskStore.list({}).filter(
      t => t.parent_task_id === expandTask.id,
    )
    expect(children).toHaveLength(2)
    expect(updatedDownstream.depends_on).not.toContain(expandTask.id)
    for (const child of children) {
      expect(updatedDownstream.depends_on).toContain(child.id)
    }
  })

  it('skips when no result', () => {
    const task = taskStore.create({
      type: 'spec',
      summary: 'No result',
      prompt: 'P',
      backend: 'cc',
      metadata: { expand: true },
    })
    taskStore.transition(task.id, TaskStatus.IN_PROGRESS, { lease_owner: 'test' })
    taskStore.transition(task.id, TaskStatus.REVIEW, { result: 'temp' })
    taskStore.update(task.id, { result: null })
    taskStore.transition(task.id, TaskStatus.DONE)

    const doneTask = taskStore.getById(task.id)!
    handler.onExpandComplete(doneTask)

    const children = taskStore.list({}).filter(
      t => t.parent_task_id === task.id,
    )
    expect(children).toHaveLength(0)
  })

  it('logs error on parse failure without throwing', () => {
    const task = createExpandTask({ result: 'invalid json garbage' })
    // Should not throw
    handler.onExpandComplete(task)

    const children = taskStore.list({}).filter(
      t => t.parent_task_id === task.id,
    )
    expect(children).toHaveLength(0)

    const logs = auditLog.getLog({ task_id: task.id })
    const errorLog = logs.find(l => l.action === 'expand_parse_error')
    expect(errorLog).toBeDefined()
  })

  it('propagates auto_review to expanded children', () => {
    const autoReview = {
      reviewers: [{ backend: 'openrouter' }],
      strategy: 'all_must_approve',
    }
    const result = JSON.stringify([
      { type: 'code', summary: 'A', prompt: 'P', backend: 'cc' },
    ])
    const task = createExpandTask({ result, auto_review: autoReview })
    handler.onExpandComplete(task)

    const children = taskStore.list({}).filter(
      t => t.parent_task_id === task.id,
    )
    expect(children[0].auto_review).toEqual(autoReview)
  })

  it('sets pipeline_id and pipeline_step on expanded children', () => {
    const result = JSON.stringify([
      { type: 'code', summary: 'A', prompt: 'P', backend: 'cc' },
    ])
    const task = createExpandTask({
      result,
      pipelineId: 'my-pipe',
      pipelineStep: 2,
    })
    handler.onExpandComplete(task)

    const children = taskStore.list({}).filter(
      t => t.parent_task_id === task.id,
    )
    expect(children[0].pipeline_id).toBe('my-pipe')
    expect(children[0].pipeline_step).toBe(3) // parent step + 1
  })
})
