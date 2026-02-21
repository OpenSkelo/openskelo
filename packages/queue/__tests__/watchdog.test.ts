import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import type Database from 'better-sqlite3'
import { createDatabase } from '../src/db.js'
import { TaskStore } from '../src/task-store.js'
import type { CreateTaskInput } from '../src/task-store.js'
import { TaskStatus } from '../src/state-machine.js'
import { AuditLog } from '../src/audit.js'
import { Watchdog } from '../src/watchdog.js'
import type { WatchdogConfig, WatchdogResult } from '../src/watchdog.js'

function makeTaskInput(overrides: Partial<CreateTaskInput> = {}): CreateTaskInput {
  return {
    type: 'code',
    summary: 'test task',
    prompt: 'do the thing',
    backend: 'claude-code',
    ...overrides,
  }
}

const DEFAULT_CONFIG: WatchdogConfig = {
  interval_ms: 30000,
  grace_period_ms: 30000,
  on_lease_expire: 'requeue',
}

function createExpiredTask(
  taskStore: TaskStore,
  opts: { expiredMs?: number; maxAttempts?: number; attemptCount?: number } = {},
) {
  const task = taskStore.create(makeTaskInput({ max_attempts: opts.maxAttempts ?? 5 }))
  taskStore.transition(task.id, TaskStatus.IN_PROGRESS, { lease_owner: 'test-adapter' })

  // Set lease_expires_at to a past time
  const expiredMs = opts.expiredMs ?? 120000
  const expiredAt = new Date(Date.now() - expiredMs).toISOString()
  taskStore.update(task.id, { lease_expires_at: expiredAt })

  // Set attempt_count if specified
  if (opts.attemptCount !== undefined) {
    taskStore.update(task.id, { attempt_count: opts.attemptCount })
  }

  return taskStore.getById(task.id)!
}

describe('Watchdog', () => {
  let db: Database.Database
  let taskStore: TaskStore
  let auditLog: AuditLog

  beforeEach(() => {
    db = createDatabase(':memory:')
    taskStore = new TaskStore(db)
    auditLog = new AuditLog(db)
  })

  afterEach(() => {
    db.close()
  })

  // 1. tick() requeues task with expired lease
  it('tick() requeues task with expired lease', () => {
    const task = createExpiredTask(taskStore)

    const watchdog = new Watchdog(taskStore, auditLog, DEFAULT_CONFIG)
    const results = watchdog.tick()

    expect(results).toHaveLength(1)
    expect(results[0].taskId).toBe(task.id)
    expect(results[0].action).toBe('requeued')

    const updated = taskStore.getById(task.id)!
    expect(updated.status).toBe(TaskStatus.PENDING)
    expect(updated.lease_owner).toBeNull()
    expect(updated.lease_expires_at).toBeNull()
  })

  // 2. tick() blocks task when attempts exhausted
  it('tick() blocks task when attempts exhausted', () => {
    // max_attempts=3, attempt_count=3 -> at limit
    const task = createExpiredTask(taskStore, {
      maxAttempts: 3,
      attemptCount: 3,
    })

    const watchdog = new Watchdog(taskStore, auditLog, DEFAULT_CONFIG)
    const results = watchdog.tick()

    expect(results).toHaveLength(1)
    expect(results[0].taskId).toBe(task.id)
    expect(results[0].action).toBe('blocked')

    const updated = taskStore.getById(task.id)!
    expect(updated.status).toBe(TaskStatus.BLOCKED)
  })

  // 3. tick() ignores tasks within grace period
  it('tick() ignores tasks within grace period', () => {
    const task = taskStore.create(makeTaskInput())
    taskStore.transition(task.id, TaskStatus.IN_PROGRESS, { lease_owner: 'test-adapter' })

    // Lease expired 10ms ago, grace period is 30000ms — still within grace
    const expiredAt = new Date(Date.now() - 10).toISOString()
    taskStore.update(task.id, { lease_expires_at: expiredAt })

    const watchdog = new Watchdog(taskStore, auditLog, DEFAULT_CONFIG)
    const results = watchdog.tick()

    expect(results).toHaveLength(0)

    const updated = taskStore.getById(task.id)!
    expect(updated.status).toBe(TaskStatus.IN_PROGRESS)
  })

  // 4. tick() recovers IN_PROGRESS tasks without lease_expires_at
  it('tick() recovers IN_PROGRESS task with null lease_expires_at', () => {
    const task = taskStore.create(makeTaskInput())
    taskStore.transition(task.id, TaskStatus.IN_PROGRESS, { lease_owner: 'test-adapter' })

    // Corrupt/missing lease: should be recovered immediately
    taskStore.update(task.id, { lease_expires_at: null as unknown as string })

    const watchdog = new Watchdog(taskStore, auditLog, DEFAULT_CONFIG)
    const results = watchdog.tick()

    expect(results).toHaveLength(1)
    expect(results[0].taskId).toBe(task.id)
    expect(results[0].action).toBe('requeued')

    const updated = taskStore.getById(task.id)!
    expect(updated.status).toBe(TaskStatus.PENDING)
  })

  // 5. tick() ignores PENDING tasks
  it('tick() ignores PENDING tasks', () => {
    taskStore.create(makeTaskInput())

    const watchdog = new Watchdog(taskStore, auditLog, DEFAULT_CONFIG)
    const results = watchdog.tick()

    expect(results).toHaveLength(0)
  })

  // 6. tick() logs audit entry for requeue
  it('tick() logs audit entry for requeue', () => {
    const task = createExpiredTask(taskStore)

    const watchdog = new Watchdog(taskStore, auditLog, DEFAULT_CONFIG)
    watchdog.tick()

    const entries = auditLog.getTaskHistory(task.id)
    const recoveryEntry = entries.find(e => e.action === 'watchdog_recovery')
    expect(recoveryEntry).toBeDefined()
    expect(recoveryEntry!.actor).toBe('watchdog')
    expect(recoveryEntry!.before_state).toBe(TaskStatus.IN_PROGRESS)
    expect(recoveryEntry!.after_state).toBe(TaskStatus.PENDING)
  })

  // 7. tick() logs audit entry for block
  it('tick() logs audit entry for block', () => {
    const task = createExpiredTask(taskStore, {
      maxAttempts: 1,
      attemptCount: 1,
    })

    const watchdog = new Watchdog(taskStore, auditLog, DEFAULT_CONFIG)
    watchdog.tick()

    const entries = auditLog.getTaskHistory(task.id)
    const recoveryEntry = entries.find(e => e.action === 'watchdog_recovery')
    expect(recoveryEntry).toBeDefined()
    expect(recoveryEntry!.actor).toBe('watchdog')
    expect(recoveryEntry!.before_state).toBe(TaskStatus.IN_PROGRESS)
    expect(recoveryEntry!.after_state).toBe(TaskStatus.BLOCKED)
  })

  // 8. tick() returns WatchdogResult[]
  it('tick() returns correct WatchdogResult[]', () => {
    createExpiredTask(taskStore)
    createExpiredTask(taskStore)

    const watchdog = new Watchdog(taskStore, auditLog, DEFAULT_CONFIG)
    const results = watchdog.tick()

    expect(Array.isArray(results)).toBe(true)
    expect(results).toHaveLength(2)
    for (const r of results) {
      expect(r).toHaveProperty('taskId')
      expect(r).toHaveProperty('action')
      expect(r).toHaveProperty('reason')
    }
  })

  // 9. start()/stop() controls interval
  it('start()/stop() controls interval', () => {
    vi.useFakeTimers()

    const watchdog = new Watchdog(taskStore, auditLog, DEFAULT_CONFIG)
    const tickSpy = vi.spyOn(watchdog, 'tick')

    watchdog.start()
    vi.advanceTimersByTime(DEFAULT_CONFIG.interval_ms)
    expect(tickSpy).toHaveBeenCalledTimes(1)

    watchdog.stop()
    vi.advanceTimersByTime(DEFAULT_CONFIG.interval_ms * 5)
    expect(tickSpy).toHaveBeenCalledTimes(1)

    vi.useRealTimers()
  })

  it('start() keeps running after tick() throws', () => {
    vi.useFakeTimers()

    const onError = vi.fn()
    const watchdog = new Watchdog(taskStore, auditLog, {
      ...DEFAULT_CONFIG,
      onError,
    })
    const tickSpy = vi.spyOn(watchdog, 'tick')
      .mockImplementationOnce(() => {
        throw new Error('watchdog boom')
      })
      .mockReturnValueOnce([])

    watchdog.start()
    vi.advanceTimersByTime(DEFAULT_CONFIG.interval_ms)
    vi.advanceTimersByTime(DEFAULT_CONFIG.interval_ms)

    expect(tickSpy).toHaveBeenCalledTimes(2)
    expect(onError).toHaveBeenCalledTimes(1)

    watchdog.stop()
    vi.useRealTimers()
  })

  // 10. tick() with on_lease_expire='block' always blocks
  it('tick() with on_lease_expire=block always blocks', () => {
    const task = createExpiredTask(taskStore, { attemptCount: 0 })

    const config: WatchdogConfig = {
      ...DEFAULT_CONFIG,
      on_lease_expire: 'block',
    }

    const watchdog = new Watchdog(taskStore, auditLog, config)
    const results = watchdog.tick()

    expect(results).toHaveLength(1)
    expect(results[0].action).toBe('blocked')

    const updated = taskStore.getById(task.id)!
    expect(updated.status).toBe(TaskStatus.BLOCKED)
  })
})
