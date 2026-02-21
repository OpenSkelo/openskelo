import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { createDatabase } from '../src/db.js'
import { TaskStore } from '../src/task-store.js'
import { TemplateStore } from '../src/templates.js'
import { Scheduler, parseDuration } from '../src/scheduler.js'
import type Database from 'better-sqlite3'

describe('parseDuration', () => {
  it('parses "30m" to 1800000', () => {
    expect(parseDuration('30m')).toBe(1800000)
  })

  it('parses "1h" to 3600000', () => {
    expect(parseDuration('1h')).toBe(3600000)
  })

  it('parses "6h" to 21600000', () => {
    expect(parseDuration('6h')).toBe(21600000)
  })

  it('parses "24h" to 86400000', () => {
    expect(parseDuration('24h')).toBe(86400000)
  })

  it('parses "7d" to 604800000', () => {
    expect(parseDuration('7d')).toBe(604800000)
  })

  it('rejects invalid strings', () => {
    expect(() => parseDuration('abc')).toThrow('Invalid duration')
    expect(() => parseDuration('10x')).toThrow('Invalid duration')
    expect(() => parseDuration('')).toThrow('Invalid duration')
    expect(() => parseDuration('1s')).toThrow('Invalid duration')
  })
})

describe('Scheduler', () => {
  let db: Database.Database
  let taskStore: TaskStore
  let templateStore: TemplateStore

  beforeEach(() => {
    vi.useFakeTimers()
    db = createDatabase(':memory:')
    taskStore = new TaskStore(db)
    templateStore = new TemplateStore(db, taskStore)

    // Create a template for scheduling
    templateStore.create({
      name: 'test-task',
      template_type: 'task',
      definition: {
        type: 'code',
        summary: 'Scheduled task',
        prompt: 'Do the scheduled thing',
        backend: 'claude-code',
      },
    })
  })

  afterEach(() => {
    vi.useRealTimers()
    db.close()
  })

  it('triggers template after interval elapses', () => {
    const scheduler = new Scheduler(templateStore, db, [
      { template: 'test-task', every: '1h' },
    ])

    scheduler.start()

    // Initial trigger happens immediately (no last_run_at)
    const initialTasks = taskStore.list({})
    expect(initialTasks).toHaveLength(1)

    // Advance by 1 hour
    vi.advanceTimersByTime(3600000)

    const afterTasks = taskStore.list({})
    expect(afterTasks).toHaveLength(2)

    scheduler.stop()
  })

  it('does not trigger disabled schedules', () => {
    const scheduler = new Scheduler(templateStore, db, [
      { template: 'test-task', every: '1h', enabled: false },
    ])

    scheduler.start()

    const tasks = taskStore.list({})
    expect(tasks).toHaveLength(0)

    vi.advanceTimersByTime(7200000)

    expect(taskStore.list({})).toHaveLength(0)

    scheduler.stop()
  })

  it('respects last_run_at from DB (skip if not yet due)', () => {
    // Set last_run_at to "now" and next_run_at to 1 hour from now
    const now = new Date()
    const nextRun = new Date(now.getTime() + 3600000)
    db.prepare(
      'INSERT INTO schedules (template_name, last_run_at, next_run_at) VALUES (?, ?, ?)',
    ).run('test-task', now.toISOString(), nextRun.toISOString())

    const scheduler = new Scheduler(templateStore, db, [
      { template: 'test-task', every: '1h' },
    ])

    scheduler.start()

    // Should NOT trigger immediately because next_run_at is in the future
    expect(taskStore.list({})).toHaveLength(0)

    // Advance to next_run_at
    vi.advanceTimersByTime(3600000)

    expect(taskStore.list({})).toHaveLength(1)

    scheduler.stop()
  })

  it('triggers immediately if overdue on startup', () => {
    // Set next_run_at to the past
    const past = new Date(Date.now() - 60000)
    db.prepare(
      'INSERT INTO schedules (template_name, last_run_at, next_run_at) VALUES (?, ?, ?)',
    ).run('test-task', past.toISOString(), past.toISOString())

    const scheduler = new Scheduler(templateStore, db, [
      { template: 'test-task', every: '1h' },
    ])

    scheduler.start()

    // Should trigger immediately because overdue
    expect(taskStore.list({})).toHaveLength(1)

    scheduler.stop()
  })

  it('getStatus returns correct schedule entries', () => {
    const scheduler = new Scheduler(templateStore, db, [
      { template: 'test-task', every: '1h' },
      { template: 'other-task', every: '30m', enabled: false },
    ])

    const status = scheduler.getStatus()
    expect(status).toHaveLength(2)
    expect(status[0].template).toBe('test-task')
    expect(status[0].interval_ms).toBe(3600000)
    expect(status[0].enabled).toBe(true)
    expect(status[1].template).toBe('other-task')
    expect(status[1].interval_ms).toBe(1800000)
    expect(status[1].enabled).toBe(false)
  })

  it('stop clears all intervals', () => {
    const scheduler = new Scheduler(templateStore, db, [
      { template: 'test-task', every: '1h' },
    ])

    scheduler.start()

    // Initial trigger
    expect(taskStore.list({})).toHaveLength(1)

    scheduler.stop()

    // After stop, advancing time should not trigger more tasks
    vi.advanceTimersByTime(7200000)
    expect(taskStore.list({})).toHaveLength(1)
  })

  it('does not crash on template instantiation failure', () => {
    const scheduler = new Scheduler(templateStore, db, [
      { template: 'nonexistent-template', every: '1h' },
    ])

    // Should not throw
    expect(() => {
      scheduler.start()
      vi.advanceTimersByTime(3600000)
    }).not.toThrow()

    scheduler.stop()
  })
})
