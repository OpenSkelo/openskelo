import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import type Database from 'better-sqlite3'
import type { ExecutionAdapter, AdapterResult, TaskInput } from '@openskelo/adapters'
import { createDatabase } from '../src/db.js'
import { TaskStore } from '../src/task-store.js'
import type { Task, CreateTaskInput } from '../src/task-store.js'
import { TaskStatus } from '../src/state-machine.js'
import { PriorityQueue } from '../src/priority-queue.js'
import { AuditLog } from '../src/audit.js'
import { Dispatcher } from '../src/dispatcher.js'
import type { DispatcherConfig, DispatchResult } from '../src/dispatcher.js'

function createMockAdapter(
  name: string,
  taskTypes: string[],
  executeFn?: (task: TaskInput) => Promise<AdapterResult>,
): ExecutionAdapter {
  return {
    name,
    taskTypes,
    canHandle: vi.fn((task: TaskInput) => taskTypes.includes(task.type)),
    execute: vi.fn(executeFn ?? (async () => ({
      output: 'done',
      exit_code: 0,
      duration_ms: 100,
    }))),
    abort: vi.fn(async () => {}),
  }
}

/** Adapter whose execute() never resolves — task stays IN_PROGRESS */
function createHangingAdapter(
  name: string,
  taskTypes: string[],
): ExecutionAdapter {
  return createMockAdapter(name, taskTypes, () => new Promise(() => {}))
}

function makeTaskInput(overrides: Partial<CreateTaskInput> = {}): CreateTaskInput {
  return {
    type: 'code',
    summary: 'test task',
    prompt: 'do the thing',
    backend: 'claude-code',
    ...overrides,
  }
}

const DEFAULT_CONFIG: DispatcherConfig = {
  poll_interval_ms: 5000,
  lease_ttl_ms: 1200000,
  heartbeat_interval_ms: 60000,
  wip_limits: { default: 2 },
}

describe('Dispatcher', () => {
  let db: Database.Database
  let taskStore: TaskStore
  let priorityQueue: PriorityQueue
  let auditLog: AuditLog

  beforeEach(() => {
    db = createDatabase(':memory:')
    taskStore = new TaskStore(db)
    priorityQueue = new PriorityQueue(db)
    auditLog = new AuditLog(db)
  })

  afterEach(() => {
    db.close()
  })

  // 1. tick() dispatches eligible task
  it('tick() dispatches eligible task', async () => {
    const adapter = createHangingAdapter('claude-code', ['code'])
    const task = taskStore.create(makeTaskInput())
    const dispatcher = new Dispatcher(taskStore, priorityQueue, auditLog, [adapter], DEFAULT_CONFIG)

    const results = await dispatcher.tick()

    expect(results).toHaveLength(1)
    expect(results[0].taskId).toBe(task.id)
    expect(results[0].adapterId).toBe('claude-code')
    expect(results[0].action).toBe('dispatched')

    const updated = taskStore.getById(task.id)!
    expect(updated.status).toBe(TaskStatus.IN_PROGRESS)
    expect(updated.lease_owner).toBe('claude-code')
  })

  // 2. tick() respects WIP limits
  it('tick() respects WIP limits', async () => {
    const adapter = createMockAdapter('claude-code', ['code'])
    const config: DispatcherConfig = {
      ...DEFAULT_CONFIG,
      wip_limits: { code: 1 },
    }

    // Create first task and move to IN_PROGRESS
    const t1 = taskStore.create(makeTaskInput())
    taskStore.transition(t1.id, TaskStatus.IN_PROGRESS, { lease_owner: 'claude-code' })

    // Create second PENDING task
    taskStore.create(makeTaskInput())

    const dispatcher = new Dispatcher(taskStore, priorityQueue, auditLog, [adapter], config)
    const results = await dispatcher.tick()

    // Should not dispatch because WIP limit of 1 is reached
    const dispatched = results.filter(r => r.action === 'dispatched')
    expect(dispatched).toHaveLength(0)
  })

  // 3. tick() skips tasks with unmet dependencies
  it('tick() skips tasks with unmet dependencies', async () => {
    const adapter = createMockAdapter('claude-code', ['code'])

    // Create a dependency task that is NOT done
    const dep = taskStore.create(makeTaskInput({ summary: 'dependency' }))

    // Create a task that depends on the dependency
    const task = taskStore.create(makeTaskInput({
      summary: 'dependent',
      depends_on: [dep.id],
    }))

    const dispatcher = new Dispatcher(taskStore, priorityQueue, auditLog, [adapter], DEFAULT_CONFIG)
    const results = await dispatcher.tick()

    // The dep task should be dispatched but the dependent task should not
    const dispatched = results.filter(r => r.action === 'dispatched')
    expect(dispatched).toHaveLength(1)
    expect(dispatched[0].taskId).toBe(dep.id)

    // The dependent task should still be PENDING
    const dependentTask = taskStore.getById(task.id)!
    expect(dependentTask.status).toBe(TaskStatus.PENDING)
  })

  // 4. tick() dispatches tasks with met dependencies
  it('tick() dispatches tasks with met dependencies', async () => {
    const adapter = createMockAdapter('claude-code', ['code'])

    // Create a dependency task and mark it DONE
    const dep = taskStore.create(makeTaskInput({ summary: 'dependency' }))
    taskStore.transition(dep.id, TaskStatus.IN_PROGRESS, { lease_owner: 'test' })
    taskStore.transition(dep.id, TaskStatus.REVIEW, { result: 'ok' })
    taskStore.transition(dep.id, TaskStatus.DONE)

    // Create a task depending on the done task
    const task = taskStore.create(makeTaskInput({
      summary: 'dependent',
      depends_on: [dep.id],
    }))

    const dispatcher = new Dispatcher(taskStore, priorityQueue, auditLog, [adapter], DEFAULT_CONFIG)
    const results = await dispatcher.tick()

    const dispatched = results.filter(r => r.action === 'dispatched')
    expect(dispatched).toHaveLength(1)
    expect(dispatched[0].taskId).toBe(task.id)
  })

  // 5. tick() selects correct adapter
  it('tick() selects correct adapter for task type', async () => {
    const codeAdapter = createMockAdapter('claude-code', ['code'])
    const shellAdapter = createMockAdapter('shell', ['shell'])

    const task = taskStore.create(makeTaskInput({ type: 'shell', backend: 'shell' }))

    const dispatcher = new Dispatcher(
      taskStore, priorityQueue, auditLog,
      [codeAdapter, shellAdapter],
      DEFAULT_CONFIG,
    )
    const results = await dispatcher.tick()

    expect(results).toHaveLength(1)
    expect(results[0].adapterId).toBe('shell')
    expect(results[0].taskId).toBe(task.id)
  })

  // 6. tick() dispatches to first available adapter
  it('tick() dispatches to first available adapter when multiple match', async () => {
    const adapter1 = createMockAdapter('adapter-1', ['code'])
    const adapter2 = createMockAdapter('adapter-2', ['code'])

    taskStore.create(makeTaskInput())

    const dispatcher = new Dispatcher(
      taskStore, priorityQueue, auditLog,
      [adapter1, adapter2],
      DEFAULT_CONFIG,
    )
    const results = await dispatcher.tick()

    const dispatched = results.filter(r => r.action === 'dispatched')
    expect(dispatched).toHaveLength(1)
    expect(dispatched[0].adapterId).toBe('adapter-1')
  })

  // 7. tick() sets lease_expires_at on claim
  it('tick() sets lease_expires_at on claim', async () => {
    const adapter = createHangingAdapter('claude-code', ['code'])
    const task = taskStore.create(makeTaskInput())

    const before = Date.now()
    const dispatcher = new Dispatcher(taskStore, priorityQueue, auditLog, [adapter], DEFAULT_CONFIG)
    await dispatcher.tick()
    const after = Date.now()

    const updated = taskStore.getById(task.id)!
    expect(updated.lease_expires_at).toBeDefined()
    const leaseTime = new Date(updated.lease_expires_at!).getTime()
    expect(leaseTime).toBeGreaterThanOrEqual(before + DEFAULT_CONFIG.lease_ttl_ms)
    expect(leaseTime).toBeLessThanOrEqual(after + DEFAULT_CONFIG.lease_ttl_ms)
  })

  // 8. tick() returns DispatchResult[]
  it('tick() returns correct DispatchResult[]', async () => {
    const adapter = createMockAdapter('claude-code', ['code'])
    taskStore.create(makeTaskInput())

    const dispatcher = new Dispatcher(taskStore, priorityQueue, auditLog, [adapter], DEFAULT_CONFIG)
    const results = await dispatcher.tick()

    expect(Array.isArray(results)).toBe(true)
    expect(results[0]).toHaveProperty('taskId')
    expect(results[0]).toHaveProperty('adapterId')
    expect(results[0]).toHaveProperty('action')
  })

  // 9. tick() skips adapter when all tasks are claimed
  it('tick() returns empty when no PENDING tasks', async () => {
    const adapter = createMockAdapter('claude-code', ['code'])

    const dispatcher = new Dispatcher(taskStore, priorityQueue, auditLog, [adapter], DEFAULT_CONFIG)
    const results = await dispatcher.tick()

    expect(results).toHaveLength(0)
  })

  // 10. tick() dispatches multiple tasks in one tick
  it('tick() dispatches multiple tasks for multiple adapters', async () => {
    const codeAdapter = createMockAdapter('claude-code', ['code'])
    const shellAdapter = createMockAdapter('shell', ['shell'])

    taskStore.create(makeTaskInput({ type: 'code', backend: 'claude-code' }))
    taskStore.create(makeTaskInput({ type: 'shell', backend: 'shell' }))

    const dispatcher = new Dispatcher(
      taskStore, priorityQueue, auditLog,
      [codeAdapter, shellAdapter],
      DEFAULT_CONFIG,
    )
    const results = await dispatcher.tick()

    const dispatched = results.filter(r => r.action === 'dispatched')
    expect(dispatched).toHaveLength(2)
  })

  // 11. heartbeat() extends lease
  it('heartbeat() extends lease', async () => {
    const adapter = createHangingAdapter('claude-code', ['code'])
    const task = taskStore.create(makeTaskInput())

    const dispatcher = new Dispatcher(taskStore, priorityQueue, auditLog, [adapter], DEFAULT_CONFIG)
    await dispatcher.tick()

    const beforeHb = taskStore.getById(task.id)!.lease_expires_at

    // Small delay so timestamps differ
    await new Promise(r => setTimeout(r, 10))

    dispatcher.heartbeat(task.id)

    const afterHb = taskStore.getById(task.id)!.lease_expires_at
    expect(new Date(afterHb!).getTime()).toBeGreaterThan(new Date(beforeHb!).getTime())
  })

  // 12. heartbeat() throws for non-existent task
  it('heartbeat() throws for non-existent task', () => {
    const adapter = createMockAdapter('claude-code', ['code'])
    const dispatcher = new Dispatcher(taskStore, priorityQueue, auditLog, [adapter], DEFAULT_CONFIG)

    expect(() => dispatcher.heartbeat('nonexistent')).toThrow()
  })

  // 13. release() transitions task back to PENDING
  it('release() transitions task back to PENDING', async () => {
    const adapter = createHangingAdapter('claude-code', ['code'])
    const task = taskStore.create(makeTaskInput())

    const dispatcher = new Dispatcher(taskStore, priorityQueue, auditLog, [adapter], DEFAULT_CONFIG)
    await dispatcher.tick()

    dispatcher.release(task.id)

    const updated = taskStore.getById(task.id)!
    expect(updated.status).toBe(TaskStatus.PENDING)
    expect(updated.lease_owner).toBeNull()
    expect(updated.lease_expires_at).toBeNull()
  })

  // 14. release() records error
  it('release() records error in last_error', async () => {
    const adapter = createHangingAdapter('claude-code', ['code'])
    const task = taskStore.create(makeTaskInput())

    const dispatcher = new Dispatcher(taskStore, priorityQueue, auditLog, [adapter], DEFAULT_CONFIG)
    await dispatcher.tick()

    dispatcher.release(task.id, 'something went wrong')

    const updated = taskStore.getById(task.id)!
    expect(updated.last_error).toBe('something went wrong')
  })

  // 15. release() logs audit entry
  it('release() logs audit entry', async () => {
    const adapter = createHangingAdapter('claude-code', ['code'])
    const task = taskStore.create(makeTaskInput())

    const dispatcher = new Dispatcher(taskStore, priorityQueue, auditLog, [adapter], DEFAULT_CONFIG)
    await dispatcher.tick()
    dispatcher.release(task.id, 'error occurred')

    const entries = auditLog.getTaskHistory(task.id)
    const releaseEntry = entries.find(e => e.action === 'release')
    expect(releaseEntry).toBeDefined()
    expect(releaseEntry!.before_state).toBe(TaskStatus.IN_PROGRESS)
    expect(releaseEntry!.after_state).toBe(TaskStatus.PENDING)
  })

  // 16. start()/stop() controls polling
  it('start()/stop() controls polling', () => {
    vi.useFakeTimers()
    const adapter = createMockAdapter('claude-code', ['code'])
    const dispatcher = new Dispatcher(taskStore, priorityQueue, auditLog, [adapter], DEFAULT_CONFIG)

    const tickSpy = vi.spyOn(dispatcher, 'tick')

    dispatcher.start()
    vi.advanceTimersByTime(DEFAULT_CONFIG.poll_interval_ms)
    expect(tickSpy).toHaveBeenCalledTimes(1)

    dispatcher.stop()
    vi.advanceTimersByTime(DEFAULT_CONFIG.poll_interval_ms * 5)
    expect(tickSpy).toHaveBeenCalledTimes(1)

    vi.useRealTimers()
  })

  // 17. WIP limit uses 'default' fallback
  it('WIP limit uses default fallback for unknown task types', async () => {
    const adapter = createMockAdapter('claude-code', ['code'])
    const config: DispatcherConfig = {
      ...DEFAULT_CONFIG,
      wip_limits: { default: 1 },
    }

    // Put one IN_PROGRESS code task
    const t1 = taskStore.create(makeTaskInput())
    taskStore.transition(t1.id, TaskStatus.IN_PROGRESS, { lease_owner: 'claude-code' })

    // Another PENDING code task
    taskStore.create(makeTaskInput())

    const dispatcher = new Dispatcher(taskStore, priorityQueue, auditLog, [adapter], config)
    const results = await dispatcher.tick()

    // default limit is 1 and there's already 1 IN_PROGRESS code task
    const dispatched = results.filter(r => r.action === 'dispatched')
    expect(dispatched).toHaveLength(0)
  })

  // 18. tick() converts Task to TaskInput correctly
  it('tick() converts Task to TaskInput correctly with upstream_results', async () => {
    let capturedInput: TaskInput | null = null
    const adapter = createMockAdapter('claude-code', ['code'], async (task) => {
      capturedInput = task
      return { output: 'done', exit_code: 0, duration_ms: 100 }
    })

    // Create dep, mark it done with a result
    const dep = taskStore.create(makeTaskInput({ summary: 'dep task' }))
    taskStore.transition(dep.id, TaskStatus.IN_PROGRESS, { lease_owner: 'test' })
    taskStore.transition(dep.id, TaskStatus.REVIEW, { result: '{"key":"value"}' })
    taskStore.transition(dep.id, TaskStatus.DONE)

    // Create dependent task
    const task = taskStore.create(makeTaskInput({
      summary: 'main task',
      prompt: 'do stuff',
      acceptance_criteria: ['crit1'],
      definition_of_done: ['done1'],
      backend_config: { model: 'opus' },
      depends_on: [dep.id],
    }))

    const dispatcher = new Dispatcher(taskStore, priorityQueue, auditLog, [adapter], DEFAULT_CONFIG)
    await dispatcher.tick()

    // Wait for async execution to fire
    await new Promise(r => setTimeout(r, 50))

    expect(capturedInput).not.toBeNull()
    expect(capturedInput!.id).toBe(task.id)
    expect(capturedInput!.type).toBe('code')
    expect(capturedInput!.summary).toBe('main task')
    expect(capturedInput!.prompt).toBe('do stuff')
    expect(capturedInput!.acceptance_criteria).toEqual(['crit1'])
    expect(capturedInput!.definition_of_done).toEqual(['done1'])
    expect(capturedInput!.backend).toBe('claude-code')
    expect(capturedInput!.backend_config).toEqual({ model: 'opus' })
    expect(capturedInput!.upstream_results).toEqual({ [dep.id]: { key: 'value' } })
  })
})
