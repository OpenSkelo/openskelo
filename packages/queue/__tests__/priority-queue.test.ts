import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { createDatabase } from '../src/db.js'
import { TaskStore } from '../src/task-store.js'
import { PriorityQueue } from '../src/priority-queue.js'
import { TaskStatus } from '../src/state-machine.js'
import type Database from 'better-sqlite3'

describe('PriorityQueue', () => {
  let db: Database.Database
  let store: TaskStore
  let queue: PriorityQueue

  beforeEach(() => {
    db = createDatabase(':memory:')
    store = new TaskStore(db)
    queue = new PriorityQueue(db)
  })

  afterEach(() => {
    db.close()
  })

  const base = {
    type: 'coding',
    summary: 'Task',
    prompt: 'Do something',
    backend: 'claude-code',
  }

  it('returns highest priority task first (lowest number = highest priority)', () => {
    store.create({ ...base, summary: 'Low', priority: 3 })
    store.create({ ...base, summary: 'High', priority: 0 })
    store.create({ ...base, summary: 'Med', priority: 1 })

    const next = queue.getNext()
    expect(next).not.toBeNull()
    expect(next!.summary).toBe('High')
  })

  it('returns null when no PENDING tasks', () => {
    expect(queue.getNext()).toBeNull()
  })

  it('respects priority ordering (lower number runs first)', () => {
    store.create({ ...base, summary: 'P2', priority: 2 })
    store.create({ ...base, summary: 'P0', priority: 0 })
    store.create({ ...base, summary: 'P1', priority: 1 })

    expect(queue.getNext()!.summary).toBe('P0')
  })

  it('uses manual_rank ASC when priority ties', () => {
    store.create({ ...base, summary: 'Rank 10', priority: 0, manual_rank: 10 })
    store.create({ ...base, summary: 'Rank 1', priority: 0, manual_rank: 1 })
    store.create({ ...base, summary: 'Rank 5', priority: 0, manual_rank: 5 })

    expect(queue.getNext()!.summary).toBe('Rank 1')
  })

  it('uses created_at ASC when priority and manual_rank tie', () => {
    // Manually set created_at to ensure deterministic ordering
    const t1 = store.create({ ...base, summary: 'First', priority: 0, manual_rank: 5 })
    const t2 = store.create({ ...base, summary: 'Second', priority: 0, manual_rank: 5 })
    // Force distinct timestamps
    db.prepare('UPDATE tasks SET created_at = ? WHERE id = ?').run('2025-01-01T00:00:00.000Z', t1.id)
    db.prepare('UPDATE tasks SET created_at = ? WHERE id = ?').run('2025-01-01T00:00:01.000Z', t2.id)

    const next = queue.getNext()!
    expect(next.id).toBe(t1.id)
  })

  it('null manual_rank sorts last within same priority', () => {
    store.create({ ...base, summary: 'No rank', priority: 0 })
    store.create({ ...base, summary: 'Has rank', priority: 0, manual_rank: 100 })

    expect(queue.getNext()!.summary).toBe('Has rank')
  })

  it('filters by type', () => {
    store.create({ ...base, type: 'research', summary: 'Research task' })
    store.create({ ...base, type: 'coding', summary: 'Coding task' })

    const next = queue.getNext({ type: 'research' })
    expect(next!.summary).toBe('Research task')
  })

  it('excludes specified task ids', () => {
    const t1 = store.create({ ...base, summary: 'Skip me', priority: 0 })
    store.create({ ...base, summary: 'Pick me', priority: 1 })

    const next = queue.getNext({ excludeIds: [t1.id] })
    expect(next!.summary).toBe('Pick me')
  })

  it('reorder top: task moves to front', () => {
    const t1 = store.create({ ...base, summary: 'Originally first', priority: 0 })
    const t2 = store.create({ ...base, summary: 'Move to top', priority: 0 })

    queue.reorder(t2.id, { top: true })
    expect(queue.getNext()!.id).toBe(t2.id)
  })

  it('reorder before: task moves before target', () => {
    const t1 = store.create({ ...base, summary: 'Target', priority: 0, manual_rank: 10 })
    const t2 = store.create({ ...base, summary: 'Mover', priority: 0, manual_rank: 20 })

    queue.reorder(t2.id, { before: t1.id })
    expect(queue.getNext()!.id).toBe(t2.id)
  })

  it('reorder after: task moves after target', () => {
    const t1 = store.create({ ...base, summary: 'First', priority: 0, manual_rank: 1 })
    const t2 = store.create({ ...base, summary: 'Second', priority: 0, manual_rank: 2 })
    const t3 = store.create({ ...base, summary: 'Third', priority: 0, manual_rank: 20 })

    queue.reorder(t3.id, { after: t1.id })
    // Order should be: t1, t3, t2
    const next1 = queue.getNext()!
    expect(next1.id).toBe(t1.id)
    store.transition(t1.id, TaskStatus.IN_PROGRESS, { lease_owner: 'adapter-1' })
    store.transition(t1.id, TaskStatus.REVIEW, { result: 'done' })
    store.transition(t1.id, TaskStatus.DONE)
    const next2 = queue.getNext()!
    expect(next2.id).toBe(t3.id)
  })

  it('only returns PENDING status tasks', () => {
    const t1 = store.create(base)
    const t2 = store.create(base)
    store.transition(t1.id, TaskStatus.IN_PROGRESS, { lease_owner: 'adapter-1' })
    store.transition(t2.id, TaskStatus.IN_PROGRESS, { lease_owner: 'adapter-2' })
    store.transition(t2.id, TaskStatus.REVIEW, { result: 'done' })
    store.transition(t2.id, TaskStatus.DONE)
    store.create(base) // This one stays PENDING

    const all = store.list()
    expect(all).toHaveLength(3)

    const next = queue.getNext()
    expect(next).not.toBeNull()
    expect(next!.status).toBe(TaskStatus.PENDING)
  })

  it('multiple reorders maintain consistent ordering', () => {
    const t1 = store.create({ ...base, summary: 'A', priority: 0 })
    const t2 = store.create({ ...base, summary: 'B', priority: 0 })
    const t3 = store.create({ ...base, summary: 'C', priority: 0 })

    queue.reorder(t3.id, { top: true })
    queue.reorder(t2.id, { top: true })

    // Order: t2, t3, t1
    expect(queue.getNext()!.id).toBe(t2.id)
  })

  it('empty queue returns null', () => {
    expect(queue.getNext()).toBeNull()
  })
})
