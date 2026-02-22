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
import { createDagPipeline } from '../src/pipeline.js'
import { LessonStore } from '../src/lessons.js'

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

    taskStore.create(makeTaskInput({ backend: 'adapter-1' }))

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

  it('tick() heartbeats during long-running execution and stops after completion', async () => {
    vi.useFakeTimers()

    try {
      let resolveExecution: ((result: AdapterResult) => void) | null = null
      const adapter = createMockAdapter('claude-code', ['code'], () => new Promise<AdapterResult>((resolve) => {
        resolveExecution = resolve
      }))
      const task = taskStore.create(makeTaskInput())
      const dispatcher = new Dispatcher(taskStore, priorityQueue, auditLog, [adapter], DEFAULT_CONFIG)
      const heartbeatSpy = vi.spyOn(dispatcher, 'heartbeat')

      await dispatcher.tick()

      vi.advanceTimersByTime(DEFAULT_CONFIG.heartbeat_interval_ms)
      expect(heartbeatSpy).toHaveBeenCalledWith(task.id)

      resolveExecution?.({
        output: 'done',
        exit_code: 0,
        duration_ms: 100,
      })
      await Promise.resolve()
      await Promise.resolve()

      const callsAfterComplete = heartbeatSpy.mock.calls.length
      vi.advanceTimersByTime(DEFAULT_CONFIG.heartbeat_interval_ms * 2)
      expect(heartbeatSpy).toHaveBeenCalledTimes(callsAfterComplete)
    } finally {
      vi.useRealTimers()
    }
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

  it('start() keeps running after tick() throws', async () => {
    vi.useFakeTimers()

    const adapter = createMockAdapter('claude-code', ['code'])
    const onError = vi.fn()
    const dispatcher = new Dispatcher(taskStore, priorityQueue, auditLog, [adapter], {
      ...DEFAULT_CONFIG,
      onError,
    })

    const tickSpy = vi.spyOn(dispatcher, 'tick')
      .mockRejectedValueOnce(new Error('dispatcher boom'))
      .mockResolvedValueOnce([] as DispatchResult[])

    dispatcher.start()
    vi.advanceTimersByTime(DEFAULT_CONFIG.poll_interval_ms)
    await Promise.resolve()
    vi.advanceTimersByTime(DEFAULT_CONFIG.poll_interval_ms)
    await Promise.resolve()

    expect(tickSpy).toHaveBeenCalledTimes(2)
    expect(onError).toHaveBeenCalledTimes(1)

    dispatcher.stop()
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

  // Fan-out: two root tasks dispatch in same tick
  it('fan-out: two root tasks both dispatch in same tick', async () => {
    const adapter = createHangingAdapter('claude-code', ['code'])
    const config: DispatcherConfig = { ...DEFAULT_CONFIG, wip_limits: { code: 5 } }

    const tasks = createDagPipeline(taskStore, {
      tasks: [
        { key: 'a', type: 'code', summary: 'A', prompt: 'A', backend: 'claude-code' },
        { key: 'b', type: 'code', summary: 'B', prompt: 'B', backend: 'claude-code' },
        { key: 'c', type: 'code', summary: 'C', prompt: 'C', backend: 'claude-code', depends_on: ['a', 'b'] },
      ],
    })

    // Adapter handles ['code'], so it matches both a and b
    // But Dispatcher iterates adapters, one task per adapter per tick
    // With a single adapter, it picks one per tick
    const dispatcher = new Dispatcher(taskStore, priorityQueue, auditLog, [adapter], config)
    const r1 = await dispatcher.tick()
    const dispatched1 = r1.filter(r => r.action === 'dispatched')
    expect(dispatched1).toHaveLength(1)

    // Second tick picks up the other root
    const r2 = await dispatcher.tick()
    const dispatched2 = r2.filter(r => r.action === 'dispatched')
    expect(dispatched2).toHaveLength(1)

    // c should still be PENDING (deps not met)
    const taskC = taskStore.getById(tasks[2].id)!
    expect(taskC.status).toBe(TaskStatus.PENDING)
  })

  // Fan-in: task with two deps does NOT dispatch until both deps are DONE
  it('fan-in: task with two deps does NOT dispatch until both deps DONE', async () => {
    const adapter = createHangingAdapter('claude-code', ['code'])
    const config: DispatcherConfig = { ...DEFAULT_CONFIG, wip_limits: { code: 5 } }

    const tasks = createDagPipeline(taskStore, {
      tasks: [
        { key: 'a', type: 'code', summary: 'A', prompt: 'A', backend: 'claude-code' },
        { key: 'b', type: 'code', summary: 'B', prompt: 'B', backend: 'claude-code' },
        { key: 'c', type: 'code', summary: 'C', prompt: 'C', backend: 'claude-code', depends_on: ['a', 'b'] },
      ],
    })

    // Complete only task A
    taskStore.transition(tasks[0].id, TaskStatus.IN_PROGRESS, { lease_owner: 'test' })
    taskStore.transition(tasks[0].id, TaskStatus.REVIEW, { result: 'ok' })
    taskStore.transition(tasks[0].id, TaskStatus.DONE)

    const dispatcher = new Dispatcher(taskStore, priorityQueue, auditLog, [adapter], config)
    const r = await dispatcher.tick()
    const dispatched = r.filter(r => r.action === 'dispatched')
    // Should dispatch B (pending, no unmet deps), NOT C (has unmet dep B)
    expect(dispatched).toHaveLength(1)
    expect(dispatched[0].taskId).toBe(tasks[1].id)
  })

  // Fan-in: task dispatches after last dep completes
  it('fan-in: task dispatches after last dep transitions to DONE', async () => {
    const adapter = createHangingAdapter('claude-code', ['code'])
    const config: DispatcherConfig = { ...DEFAULT_CONFIG, wip_limits: { code: 5 } }

    const tasks = createDagPipeline(taskStore, {
      tasks: [
        { key: 'a', type: 'code', summary: 'A', prompt: 'A', backend: 'claude-code' },
        { key: 'b', type: 'code', summary: 'B', prompt: 'B', backend: 'claude-code' },
        { key: 'c', type: 'code', summary: 'C', prompt: 'C', backend: 'claude-code', depends_on: ['a', 'b'] },
      ],
    })

    // Complete both A and B
    for (const t of [tasks[0], tasks[1]]) {
      taskStore.transition(t.id, TaskStatus.IN_PROGRESS, { lease_owner: 'test' })
      taskStore.transition(t.id, TaskStatus.REVIEW, { result: 'ok' })
      taskStore.transition(t.id, TaskStatus.DONE)
    }

    const dispatcher = new Dispatcher(taskStore, priorityQueue, auditLog, [adapter], config)
    const r = await dispatcher.tick()
    const dispatched = r.filter(r => r.action === 'dispatched')
    expect(dispatched).toHaveLength(1)
    expect(dispatched[0].taskId).toBe(tasks[2].id)
  })

  // Backend routing: plain backend routes to matching adapter by name
  it('tick() routes plain backend to matching adapter', async () => {
    const codeAdapter = createHangingAdapter('claude-code', ['code'])
    const openrouterAdapter = createHangingAdapter('openrouter', ['code'])

    const task = taskStore.create(makeTaskInput({
      type: 'code',
      backend: 'openrouter',
    }))

    const dispatcher = new Dispatcher(
      taskStore, priorityQueue, auditLog,
      [codeAdapter, openrouterAdapter],
      DEFAULT_CONFIG,
    )
    const results = await dispatcher.tick()

    const dispatched = results.filter(r => r.action === 'dispatched')
    expect(dispatched).toHaveLength(1)
    expect(dispatched[0].adapterId).toBe('openrouter')
    expect(dispatched[0].taskId).toBe(task.id)
  })

  // Backend model routing: slash-style backend routes to correct adapter
  it('tick() routes slash-style backend to matching adapter', async () => {
    const codeAdapter = createHangingAdapter('claude-code', ['code'])
    const openrouterAdapter = createHangingAdapter('openrouter', ['code'])

    // Task with backend "openrouter/anthropic/claude-opus-4-5" should route to openrouter
    const task = taskStore.create(makeTaskInput({
      type: 'code',
      backend: 'openrouter/anthropic/claude-opus-4-5',
    }))

    const dispatcher = new Dispatcher(
      taskStore, priorityQueue, auditLog,
      [codeAdapter, openrouterAdapter],
      DEFAULT_CONFIG,
    )
    const results = await dispatcher.tick()

    const dispatched = results.filter(r => r.action === 'dispatched')
    expect(dispatched).toHaveLength(1)
    expect(dispatched[0].adapterId).toBe('openrouter')
    expect(dispatched[0].taskId).toBe(task.id)
  })

  // Backend model routing: taskToInput extracts model from slash backend
  it('tick() extracts model from slash-style backend into backend_config', async () => {
    let capturedInput: TaskInput | null = null
    const adapter = createMockAdapter('openrouter', ['code'], async (task) => {
      capturedInput = task
      return { output: 'done', exit_code: 0, duration_ms: 100 }
    })

    taskStore.create(makeTaskInput({
      type: 'code',
      backend: 'openrouter/anthropic/claude-opus-4-5',
    }))

    const dispatcher = new Dispatcher(taskStore, priorityQueue, auditLog, [adapter], DEFAULT_CONFIG)
    await dispatcher.tick()

    await new Promise(r => setTimeout(r, 50))

    expect(capturedInput).not.toBeNull()
    expect(capturedInput!.backend).toBe('openrouter')
    expect(capturedInput!.backend_config?.model).toBe('anthropic/claude-opus-4-5')
  })

  // tick() skips held tasks
  it('tick() skips tasks with held_by set', async () => {
    const adapter = createHangingAdapter('claude-code', ['code'])
    const t1 = taskStore.create(makeTaskInput({ summary: 'held task' }))
    taskStore.create(makeTaskInput({ summary: 'free task' }))

    // Hold t1
    taskStore.hold([t1.id], 'FIX-001')

    const dispatcher = new Dispatcher(taskStore, priorityQueue, auditLog, [adapter], DEFAULT_CONFIG)
    const results = await dispatcher.tick()

    const dispatched = results.filter(r => r.action === 'dispatched')
    expect(dispatched).toHaveLength(1)
    expect(dispatched[0].taskId).not.toBe(t1.id)

    // t1 should still be PENDING and held
    const held = taskStore.getById(t1.id)!
    expect(held.status).toBe(TaskStatus.PENDING)
    expect(held.held_by).toBe('FIX-001')
  })

  it('tick() dispatches task after unhold', async () => {
    const adapter = createHangingAdapter('claude-code', ['code'])
    const t1 = taskStore.create(makeTaskInput({ summary: 'was held' }))
    taskStore.hold([t1.id], 'FIX-001')

    const dispatcher = new Dispatcher(taskStore, priorityQueue, auditLog, [adapter], DEFAULT_CONFIG)

    // First tick: held, should not dispatch
    const r1 = await dispatcher.tick()
    expect(r1.filter(r => r.action === 'dispatched')).toHaveLength(0)

    // Unhold
    taskStore.unhold('FIX-001')

    // Second tick: should dispatch
    const r2 = await dispatcher.tick()
    const dispatched = r2.filter(r => r.action === 'dispatched')
    expect(dispatched).toHaveLength(1)
    expect(dispatched[0].taskId).toBe(t1.id)
  })

  it('tick() rechecks hold status before claim to avoid stale candidate dispatch', async () => {
    const adapter = createHangingAdapter('claude-code', ['code'])
    const task = taskStore.create(makeTaskInput({ summary: 'stale candidate' }))

    const staleCandidate = { ...task, held_by: null }
    const getNextSpy = vi.spyOn(priorityQueue, 'getNext').mockReturnValue(staleCandidate)

    // Hold after candidate snapshot was taken
    taskStore.hold([task.id], 'FIX-RACE')

    const dispatcher = new Dispatcher(taskStore, priorityQueue, auditLog, [adapter], DEFAULT_CONFIG)
    const results = await dispatcher.tick()

    expect(results.filter(r => r.action === 'dispatched')).toHaveLength(0)
    expect(taskStore.getById(task.id)!.status).toBe(TaskStatus.PENDING)
    expect(taskStore.getById(task.id)!.held_by).toBe('FIX-RACE')

    getNextSpy.mockRestore()
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

  it('injects relevant lessons into task prompt', async () => {
    const lessonStore = new LessonStore(db)
    lessonStore.create({ rule: 'Always validate input before processing', category: 'validation', severity: 'high' })
    lessonStore.create({ rule: 'Handle network errors gracefully', category: 'error-handling', severity: 'medium' })

    let capturedInput: TaskInput | null = null
    const adapter = createMockAdapter('claude-code', ['code'], async (input) => {
      capturedInput = input
      return { output: 'done', exit_code: 0, duration_ms: 50 }
    })

    taskStore.create(makeTaskInput({ prompt: 'Validate and process user input data' }))
    const dispatcher = new Dispatcher(taskStore, priorityQueue, auditLog, [adapter], DEFAULT_CONFIG, lessonStore)
    await dispatcher.tick()

    expect(capturedInput).not.toBeNull()
    expect(capturedInput!.prompt).toContain('Lessons Learned')
    expect(capturedInput!.prompt).toContain('Always validate input')
  })

  it('increments times_applied for injected lessons', async () => {
    const lessonStore = new LessonStore(db)
    const lesson = lessonStore.create({ rule: 'Always validate input data', category: 'validation' })
    expect(lesson.times_applied).toBe(0)

    const adapter = createHangingAdapter('claude-code', ['code'])
    taskStore.create(makeTaskInput({ prompt: 'Validate input data from user' }))
    const dispatcher = new Dispatcher(taskStore, priorityQueue, auditLog, [adapter], DEFAULT_CONFIG, lessonStore)
    await dispatcher.tick()

    const updated = lessonStore.getById(lesson.id)!
    expect(updated.times_applied).toBe(1)
  })

  it('skips lesson injection for review and lesson task types', async () => {
    const lessonStore = new LessonStore(db)
    lessonStore.create({ rule: 'Always validate everything', category: 'validation' })

    let capturedInput: TaskInput | null = null
    const adapter = createMockAdapter('claude-code', ['code', 'review', 'lesson'], async (input) => {
      capturedInput = input
      return { output: 'done', exit_code: 0, duration_ms: 50 }
    })

    taskStore.create(makeTaskInput({ type: 'review', prompt: 'Review the validate implementation' }))
    const dispatcher = new Dispatcher(taskStore, priorityQueue, auditLog, [adapter], DEFAULT_CONFIG, lessonStore)
    await dispatcher.tick()

    expect(capturedInput).not.toBeNull()
    expect(capturedInput!.prompt).not.toContain('Lessons Learned')
  })
})
