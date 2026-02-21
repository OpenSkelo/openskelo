import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { createDatabase } from '../src/db.js'
import { TaskStore } from '../src/task-store.js'
import { TaskStatus } from '../src/state-machine.js'
import type Database from 'better-sqlite3'

describe('TaskStore', () => {
  let db: Database.Database
  let store: TaskStore

  beforeEach(() => {
    db = createDatabase(':memory:')
    store = new TaskStore(db)
  })

  afterEach(() => {
    db.close()
  })

  const minimal = {
    type: 'coding',
    summary: 'Fix the bug',
    prompt: 'Fix the authentication bug in auth.ts',
    backend: 'claude-code',
  }

  function moveToInProgress(taskId: string) {
    return store.transition(taskId, TaskStatus.IN_PROGRESS, { lease_owner: 'adapter-1' })
  }

  function moveToDone(taskId: string) {
    moveToInProgress(taskId)
    store.transition(taskId, TaskStatus.REVIEW, { result: 'ok' })
    return store.transition(taskId, TaskStatus.DONE)
  }

  describe('create()', () => {
    it('generates ULID id', () => {
      const task = store.create(minimal)
      expect(task.id).toMatch(/^[0-9A-Z]{26}$/)
    })

    it('sets created_at and updated_at', () => {
      const task = store.create(minimal)
      expect(task.created_at).toBeDefined()
      expect(task.updated_at).toBeDefined()
      // Should be valid ISO strings
      expect(new Date(task.created_at).toISOString()).toBe(task.created_at)
    })

    it('defaults status to PENDING', () => {
      const task = store.create(minimal)
      expect(task.status).toBe(TaskStatus.PENDING)
    })

    it('stores and retrieves JSON fields', () => {
      const task = store.create({
        ...minimal,
        acceptance_criteria: ['Works', 'Tests pass'],
        gates: [{ type: 'regex', pattern: 'test' }],
        metadata: { repo: '/tmp', tags: ['urgent'] },
      })
      const fetched = store.getById(task.id)!
      expect(fetched.acceptance_criteria).toEqual(['Works', 'Tests pass'])
      expect(fetched.gates).toEqual([{ type: 'regex', pattern: 'test' }])
      expect(fetched.metadata).toEqual({ repo: '/tmp', tags: ['urgent'] })
    })

    it('handles empty optional fields gracefully', () => {
      const task = store.create(minimal)
      expect(task.acceptance_criteria).toEqual([])
      expect(task.definition_of_done).toEqual([])
      expect(task.depends_on).toEqual([])
      expect(task.feedback_history).toEqual([])
      expect(task.gates).toEqual([])
      expect(task.metadata).toEqual({})
    })
  })

  describe('getById()', () => {
    it('returns task', () => {
      const created = store.create(minimal)
      const fetched = store.getById(created.id)
      expect(fetched).not.toBeNull()
      expect(fetched!.id).toBe(created.id)
      expect(fetched!.summary).toBe('Fix the bug')
    })

    it('returns null for missing id', () => {
      expect(store.getById('nonexistent')).toBeNull()
    })
  })

  describe('list()', () => {
    it('returns all tasks', () => {
      store.create(minimal)
      store.create({ ...minimal, summary: 'Task 2' })
      expect(store.list()).toHaveLength(2)
    })

    it('filters by status', () => {
      const t1 = store.create(minimal)
      store.create(minimal)
      moveToInProgress(t1.id)
      expect(store.list({ status: TaskStatus.PENDING })).toHaveLength(1)
      expect(store.list({ status: TaskStatus.IN_PROGRESS })).toHaveLength(1)
    })

    it('filters by type', () => {
      store.create(minimal)
      store.create({ ...minimal, type: 'research' })
      expect(store.list({ type: 'coding' })).toHaveLength(1)
      expect(store.list({ type: 'research' })).toHaveLength(1)
    })

    it('filters by pipeline_id', () => {
      const t1 = store.create(minimal)
      store.create(minimal)
      store.update(t1.id, { pipeline_id: 'PL-1' })
      expect(store.list({ pipeline_id: 'PL-1' })).toHaveLength(1)
    })

    it('supports limit and offset', () => {
      for (let i = 0; i < 10; i++) {
        store.create({ ...minimal, summary: `Task ${i}` })
      }
      expect(store.list({ limit: 3 })).toHaveLength(3)
      expect(store.list({ limit: 3, offset: 8 })).toHaveLength(2)
    })

    it('returns empty array for no matches', () => {
      expect(store.list({ status: TaskStatus.DONE })).toEqual([])
    })
  })

  describe('update()', () => {
    it('changes fields', () => {
      const task = store.create(minimal)
      const updated = store.update(task.id, { summary: 'Updated summary' })
      expect(updated.summary).toBe('Updated summary')
    })

    it('sets new updated_at', () => {
      const task = store.create(minimal)
      const before = task.updated_at
      // Small delay to ensure different timestamp
      const updated = store.update(task.id, { summary: 'Changed' })
      expect(updated.updated_at).toBeDefined()
      // updated_at should be >= before
      expect(new Date(updated.updated_at).getTime()).toBeGreaterThanOrEqual(new Date(before).getTime())
    })

    it('preserves unchanged fields', () => {
      const task = store.create({
        ...minimal,
        acceptance_criteria: ['Keep this'],
      })
      const updated = store.update(task.id, { summary: 'New' })
      expect(updated.acceptance_criteria).toEqual(['Keep this'])
      expect(updated.prompt).toBe(minimal.prompt)
    })

    it('rejects unknown update columns', () => {
      const task = store.create(minimal)
      expect(() => store.update(task.id, {
        ['status; DROP TABLE tasks; --']: 'x',
      } as never)).toThrow('Invalid update column')
    })
  })



  describe('transition()', () => {
    it('moves through guarded lifecycle', () => {
      const task = store.create(minimal)
      const inProgress = store.transition(task.id, TaskStatus.IN_PROGRESS, { lease_owner: 'adapter-1' })
      expect(inProgress.status).toBe(TaskStatus.IN_PROGRESS)

      const review = store.transition(task.id, TaskStatus.REVIEW, { result: 'implemented' })
      expect(review.status).toBe(TaskStatus.REVIEW)

      const done = store.transition(task.id, TaskStatus.DONE)
      expect(done.status).toBe(TaskStatus.DONE)
    })

    it('sets lease_owner and lease_expires_at on PENDING → IN_PROGRESS transition', () => {
      const task = store.create(minimal)
      const leaseExpiry = new Date(Date.now() + 60000).toISOString()

      const inProgress = store.transition(task.id, TaskStatus.IN_PROGRESS, {
        lease_owner: 'adapter-1',
        lease_expires_at: leaseExpiry,
      })

      expect(inProgress.status).toBe(TaskStatus.IN_PROGRESS)
      expect(inProgress.lease_owner).toBe('adapter-1')
      expect(inProgress.lease_expires_at).toBe(leaseExpiry)
    })

    it('rejects direct status updates via update()', () => {
      const task = store.create(minimal)
      expect(() => store.update(task.id, { status: TaskStatus.DONE } as never)).toThrow(
        'Use transition()',
      )
    })
  })

  describe('dependency validation', () => {
    it('rejects unknown depends_on task ids on create', () => {
      expect(() => store.create({
        ...minimal,
        depends_on: ['MISSING-TASK'],
      })).toThrow('unknown task ids')
    })

    it('rejects cyclic depends_on updates', () => {
      const a = store.create({ ...minimal, summary: 'A' })
      const b = store.create({ ...minimal, summary: 'B', depends_on: [a.id] })

      expect(() => store.update(a.id, { depends_on: [b.id] })).toThrow('cycle detected')
    })
  })

  describe('delete()', () => {
    it('removes task', () => {
      const task = store.create(minimal)
      expect(store.delete(task.id)).toBe(true)
      expect(store.getById(task.id)).toBeNull()
    })

    it('returns false for missing id', () => {
      expect(store.delete('nonexistent')).toBe(false)
    })
  })

  describe('count()', () => {
    it('returns total', () => {
      store.create(minimal)
      store.create(minimal)
      expect(store.count()).toBe(2)
    })

    it('filters by status', () => {
      const t1 = store.create(minimal)
      store.create(minimal)
      moveToDone(t1.id)
      expect(store.count({ status: TaskStatus.PENDING })).toBe(1)
      expect(store.count({ status: TaskStatus.DONE })).toBe(1)
    })

    it('filters by type', () => {
      store.create(minimal)
      store.create({ ...minimal, type: 'research' })
      expect(store.count({ type: 'coding' })).toBe(1)
    })
  })

  it('multiple tasks ordered by created_at', () => {
    const t1 = store.create({ ...minimal, summary: 'First' })
    const t2 = store.create({ ...minimal, summary: 'Second' })
    const t3 = store.create({ ...minimal, summary: 'Third' })
    const all = store.list()
    expect(all[0].id).toBe(t1.id)
    expect(all[2].id).toBe(t3.id)
  })

  it('JSON roundtrip: complex nested metadata', () => {
    const complex = {
      repo: '/tmp/project',
      tags: ['urgent', 'backend'],
      nested: { deep: { value: [1, 2, 3] } },
    }
    const task = store.create({ ...minimal, metadata: complex })
    const fetched = store.getById(task.id)!
    expect(fetched.metadata).toEqual(complex)
  })

  it('can store and retrieve gates as GateDefinition[]', () => {
    const gates = [
      { type: 'json_schema', schema: { required: ['name'] } },
      { type: 'word_count', min: 10, max: 100 },
    ]
    const task = store.create({ ...minimal, gates })
    const fetched = store.getById(task.id)!
    expect(fetched.gates).toEqual(gates)
  })

  describe('inject()', () => {
    it('creates task with boosted priority', () => {
      const task = store.inject({
        ...minimal,
        priority_boost: -10,
      })
      expect(task.priority).toBe(-10)
      expect(task.status).toBe(TaskStatus.PENDING)
    })

    it('with inject_before adds dependency to target task', () => {
      const target = store.create({ ...minimal, summary: 'Target' })
      const injected = store.inject({
        ...minimal,
        summary: 'Injected',
        inject_before: target.id,
        priority_boost: -5,
      })

      const updatedTarget = store.getById(target.id)!
      expect(updatedTarget.depends_on).toContain(injected.id)
    })

    it('without inject_before works like create', () => {
      const task = store.inject({
        ...minimal,
        summary: 'Simple inject',
      })
      expect(task.id).toBeTruthy()
      expect(task.summary).toBe('Simple inject')
      expect(task.priority).toBe(0)
    })

    it('throws when inject_before target does not exist', () => {
      expect(() => store.inject({
        ...minimal,
        summary: 'Bad inject',
        inject_before: 'MISSING-TASK',
      })).toThrow('inject_before target task not found')
    })

    it('priority_boost overrides priority', () => {
      const task = store.inject({
        ...minimal,
        priority: 5,
        priority_boost: -10,
      })
      expect(task.priority).toBe(-10)
    })
  })

  it('update changes result field', () => {
    const task = store.create(minimal)
    moveToInProgress(task.id)
    store.transition(task.id, TaskStatus.REVIEW, { result: 'original' })
    const updated = store.update(task.id, { result: 'new result' })
    expect(updated.result).toBe('new result')
  })

  it('large text fields handled correctly', () => {
    const longPrompt = 'x'.repeat(100_000)
    const task = store.create({ ...minimal, prompt: longPrompt })
    const fetched = store.getById(task.id)!
    expect(fetched.prompt).toHaveLength(100_000)
  })
})
