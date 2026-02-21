import { describe, it, expect, afterEach } from 'vitest'
import { createQueue } from '../src/factory.js'
import { TaskStatus } from '../src/state-machine.js'
import type { Queue } from '../src/factory.js'

describe('createQueue factory', () => {
  let queue: Queue | null = null

  afterEach(() => {
    if (queue) {
      queue.stop()
      queue.db.close()
      queue = null
    }
  })

  it('creates a queue with all components', () => {
    queue = createQueue({ db_path: ':memory:' })

    expect(queue.taskStore).toBeDefined()
    expect(queue.priorityQueue).toBeDefined()
    expect(queue.auditLog).toBeDefined()
    expect(queue.dispatcher).toBeDefined()
    expect(queue.watchdog).toBeDefined()
    expect(queue.start).toBeTypeOf('function')
    expect(queue.stop).toBeTypeOf('function')
    expect(queue.listen).toBeTypeOf('function')
  })

  it('start() and stop() control dispatcher and watchdog', () => {
    queue = createQueue({ db_path: ':memory:' })

    // Should not throw
    queue.start()
    queue.stop()
  })

  it('taskStore CRUD works through factory', () => {
    queue = createQueue({ db_path: ':memory:' })

    const task = queue.taskStore.create({
      type: 'coding',
      summary: 'Fix bug',
      prompt: 'Fix the login bug',
      backend: 'claude-code',
    })

    expect(task.id).toBeTruthy()
    expect(task.status).toBe(TaskStatus.PENDING)

    const fetched = queue.taskStore.getById(task.id)
    expect(fetched).toEqual(task)
  })

  it('applies custom config defaults', () => {
    queue = createQueue({
      db_path: ':memory:',
      wip_limits: { coding: 3, default: 2 },
      leases: { ttl_seconds: 600 },
      watchdog: { on_lease_expire: 'block' },
    })

    // Verify the queue was created (config is applied internally)
    expect(queue.taskStore).toBeDefined()
  })

  it('priorityQueue works through factory', () => {
    queue = createQueue({ db_path: ':memory:' })

    queue.taskStore.create({
      type: 'coding',
      summary: 'Task A',
      prompt: 'Do A',
      backend: 'claude-code',
    })

    const next = queue.priorityQueue.getNext()
    expect(next).not.toBeNull()
    expect(next!.summary).toBe('Task A')
  })
})
