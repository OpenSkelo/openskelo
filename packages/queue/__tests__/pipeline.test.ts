import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { createDatabase } from '../src/db.js'
import { TaskStore } from '../src/task-store.js'
import { TaskStatus } from '../src/state-machine.js'
import {
  createPipeline,
  createDagPipeline,
  areDependenciesMet,
  getUpstreamResults,
} from '../src/pipeline.js'
import type Database from 'better-sqlite3'

describe('Pipeline', () => {
  let db: Database.Database
  let store: TaskStore

  beforeEach(() => {
    db = createDatabase(':memory:')
    store = new TaskStore(db)
  })

  afterEach(() => {
    db.close()
  })

  const step = (summary: string) => ({
    type: 'coding',
    summary,
    prompt: `Do: ${summary}`,
    backend: 'claude-code',
  })

  describe('createPipeline', () => {
    it('generates shared pipeline_id', () => {
      const tasks = createPipeline(store, [step('Research'), step('Write'), step('Review')])
      const pipelineIds = new Set(tasks.map(t => t.pipeline_id))
      expect(pipelineIds.size).toBe(1)
      expect(tasks[0].pipeline_id).toMatch(/^[0-9A-Z]{26}$/)
    })

    it('sets sequential pipeline_step', () => {
      const tasks = createPipeline(store, [step('A'), step('B'), step('C')])
      expect(tasks[0].pipeline_step).toBe(1)
      expect(tasks[1].pipeline_step).toBe(2)
      expect(tasks[2].pipeline_step).toBe(3)
    })

    it('sets depends_on chain', () => {
      const tasks = createPipeline(store, [step('A'), step('B'), step('C')])
      expect(tasks[0].depends_on).toEqual([])
      expect(tasks[1].depends_on).toEqual([tasks[0].id])
      expect(tasks[2].depends_on).toEqual([tasks[1].id])
    })

    it('first task has no dependencies', () => {
      const tasks = createPipeline(store, [step('Only step')])
      expect(tasks[0].depends_on).toEqual([])
    })

    it('last task depends on second-to-last', () => {
      const tasks = createPipeline(store, [step('A'), step('B')])
      expect(tasks[1].depends_on).toEqual([tasks[0].id])
    })

    it('pipeline tasks are all created in PENDING status', () => {
      const tasks = createPipeline(store, [step('A'), step('B'), step('C')])
      expect(tasks.every(t => t.status === TaskStatus.PENDING)).toBe(true)
    })
  })

  describe('createDagPipeline', () => {
    const node = (key: string, depends_on?: string[]) => ({
      key,
      type: 'code',
      summary: `Task ${key}`,
      prompt: `Do: ${key}`,
      backend: 'claude-code',
      depends_on,
    })

    it('linear chain produces same structure as createPipeline', () => {
      const tasks = createDagPipeline(store, {
        tasks: [
          node('a'),
          node('b', ['a']),
          node('c', ['b']),
        ],
      })
      expect(tasks).toHaveLength(3)
      expect(tasks[0].pipeline_step).toBe(0)
      expect(tasks[1].pipeline_step).toBe(1)
      expect(tasks[2].pipeline_step).toBe(2)
      expect(tasks[0].depends_on).toEqual([])
      expect(tasks[1].depends_on).toEqual([tasks[0].id])
      expect(tasks[2].depends_on).toEqual([tasks[1].id])
      // All share pipeline_id
      const ids = new Set(tasks.map(t => t.pipeline_id))
      expect(ids.size).toBe(1)
    })

    it('fan-out: two roots, one merge node', () => {
      const tasks = createDagPipeline(store, {
        tasks: [
          node('a'),
          node('b'),
          node('c', ['a', 'b']),
        ],
      })
      expect(tasks).toHaveLength(3)
      // a and b are step 0 (roots), c is step 1
      const byKey = new Map(tasks.map(t => [t.summary, t]))
      expect(byKey.get('Task a')!.pipeline_step).toBe(0)
      expect(byKey.get('Task b')!.pipeline_step).toBe(0)
      expect(byKey.get('Task c')!.pipeline_step).toBe(1)
      // c depends on both a and b
      const cTask = byKey.get('Task c')!
      expect(cTask.depends_on).toHaveLength(2)
      expect(cTask.depends_on).toContain(byKey.get('Task a')!.id)
      expect(cTask.depends_on).toContain(byKey.get('Task b')!.id)
    })

    it('fan-out/fan-in: A,B parallel → C merges → D,E parallel → F merges', () => {
      const tasks = createDagPipeline(store, {
        tasks: [
          node('a'),
          node('b'),
          node('c', ['a', 'b']),
          node('d', ['c']),
          node('e', ['c']),
          node('f', ['d', 'e']),
        ],
      })
      expect(tasks).toHaveLength(6)
      const byKey = new Map(tasks.map(t => [t.summary, t]))
      expect(byKey.get('Task a')!.pipeline_step).toBe(0)
      expect(byKey.get('Task b')!.pipeline_step).toBe(0)
      expect(byKey.get('Task c')!.pipeline_step).toBe(1)
      expect(byKey.get('Task d')!.pipeline_step).toBe(2)
      expect(byKey.get('Task e')!.pipeline_step).toBe(2)
      expect(byKey.get('Task f')!.pipeline_step).toBe(3)

      // Verify depends_on IDs
      const fTask = byKey.get('Task f')!
      expect(fTask.depends_on).toContain(byKey.get('Task d')!.id)
      expect(fTask.depends_on).toContain(byKey.get('Task e')!.id)
    })

    it('rejects duplicate keys', () => {
      expect(() => createDagPipeline(store, {
        tasks: [node('a'), node('a')],
      })).toThrow('Duplicate key: a')
    })

    it('rejects missing depends_on reference', () => {
      expect(() => createDagPipeline(store, {
        tasks: [node('a', ['nonexistent'])],
      })).toThrow('Unknown dependency: nonexistent')
    })

    it('rejects cycle (A→B→C→A)', () => {
      expect(() => createDagPipeline(store, {
        tasks: [
          node('a', ['c']),
          node('b', ['a']),
          node('c', ['b']),
        ],
      })).toThrow('Cycle detected')
    })

    it('rejects self-dependency', () => {
      expect(() => createDagPipeline(store, {
        tasks: [node('a', ['a'])],
      })).toThrow('Self-dependency: a')
    })

    it('single node with no deps works', () => {
      const tasks = createDagPipeline(store, {
        tasks: [node('only')],
      })
      expect(tasks).toHaveLength(1)
      expect(tasks[0].pipeline_step).toBe(0)
      expect(tasks[0].depends_on).toEqual([])
    })

    it('preserves optional fields (priority, max_attempts, max_bounces)', () => {
      const tasks = createDagPipeline(store, {
        tasks: [{
          key: 'a',
          type: 'code',
          summary: 'Task A',
          prompt: 'Do A',
          backend: 'claude-code',
          priority: 5,
          max_attempts: 10,
          max_bounces: 2,
        }],
      })
      expect(tasks[0].priority).toBe(5)
      expect(tasks[0].max_attempts).toBe(10)
      expect(tasks[0].max_bounces).toBe(2)
    })

    it('rejects empty pipeline', () => {
      expect(() => createDagPipeline(store, { tasks: [] })).toThrow('at least one task')
    })
  })

  describe('areDependenciesMet', () => {
    it('returns true when all deps DONE', () => {
      const tasks = createPipeline(store, [step('A'), step('B')])
      store.transition(tasks[0].id, TaskStatus.IN_PROGRESS, { lease_owner: 'adapter-1' })
      store.transition(tasks[0].id, TaskStatus.REVIEW, { result: 'step complete' })
      store.transition(tasks[0].id, TaskStatus.DONE)
      const taskB = store.getById(tasks[1].id)!
      expect(areDependenciesMet(taskB, store)).toBe(true)
    })

    it('returns false when any dep not DONE', () => {
      const tasks = createPipeline(store, [step('A'), step('B')])
      // task A is still PENDING
      const taskB = store.getById(tasks[1].id)!
      expect(areDependenciesMet(taskB, store)).toBe(false)
    })

    it('returns true when no deps', () => {
      const task = store.create({
        type: 'coding',
        summary: 'Standalone',
        prompt: 'Do it',
        backend: 'shell',
      })
      expect(areDependenciesMet(task, store)).toBe(true)
    })

    it('returns false when only some deps are DONE (fan-in)', () => {
      const tasks = createDagPipeline(store, {
        tasks: [
          { key: 'a', type: 'code', summary: 'A', prompt: 'A', backend: 'x' },
          { key: 'b', type: 'code', summary: 'B', prompt: 'B', backend: 'x' },
          { key: 'c', type: 'code', summary: 'C', prompt: 'C', backend: 'x', depends_on: ['a', 'b'] },
        ],
      })
      // Complete only A
      store.transition(tasks[0].id, TaskStatus.IN_PROGRESS, { lease_owner: 'test' })
      store.transition(tasks[0].id, TaskStatus.REVIEW, { result: 'ok' })
      store.transition(tasks[0].id, TaskStatus.DONE)

      const taskC = store.getById(tasks[2].id)!
      expect(areDependenciesMet(taskC, store)).toBe(false)
    })

    it('returns true when all fan-in deps are DONE', () => {
      const tasks = createDagPipeline(store, {
        tasks: [
          { key: 'a', type: 'code', summary: 'A', prompt: 'A', backend: 'x' },
          { key: 'b', type: 'code', summary: 'B', prompt: 'B', backend: 'x' },
          { key: 'c', type: 'code', summary: 'C', prompt: 'C', backend: 'x', depends_on: ['a', 'b'] },
        ],
      })
      // Complete both A and B
      for (const t of [tasks[0], tasks[1]]) {
        store.transition(t.id, TaskStatus.IN_PROGRESS, { lease_owner: 'test' })
        store.transition(t.id, TaskStatus.REVIEW, { result: 'ok' })
        store.transition(t.id, TaskStatus.DONE)
      }

      const taskC = store.getById(tasks[2].id)!
      expect(areDependenciesMet(taskC, store)).toBe(true)
    })
  })

  describe('getUpstreamResults', () => {
    it('returns parsed results from deps', () => {
      const tasks = createPipeline(store, [step('Research'), step('Write')])
      const result = JSON.stringify({ summary: 'Found 3 sources', sources: ['a', 'b', 'c'] })
      store.transition(tasks[0].id, TaskStatus.IN_PROGRESS, { lease_owner: 'adapter-1' })
      store.transition(tasks[0].id, TaskStatus.REVIEW, { result })
      store.transition(tasks[0].id, TaskStatus.DONE)
      const taskB = store.getById(tasks[1].id)!
      const upstream = getUpstreamResults(taskB, store)
      expect(upstream[tasks[0].id]).toEqual({ summary: 'Found 3 sources', sources: ['a', 'b', 'c'] })
    })

    it('returns empty object for no deps', () => {
      const task = store.create({
        type: 'coding',
        summary: 'Standalone',
        prompt: 'Do it',
        backend: 'shell',
      })
      expect(getUpstreamResults(task, store)).toEqual({})
    })

    it('pipeline with single task has no dependencies', () => {
      const tasks = createPipeline(store, [step('Solo')])
      expect(tasks[0].depends_on).toEqual([])
      expect(getUpstreamResults(tasks[0], store)).toEqual({})
    })

    it('collects results from multiple fan-in deps', () => {
      const tasks = createDagPipeline(store, {
        tasks: [
          { key: 'a', type: 'code', summary: 'A', prompt: 'A', backend: 'x' },
          { key: 'b', type: 'code', summary: 'B', prompt: 'B', backend: 'x' },
          { key: 'c', type: 'code', summary: 'C', prompt: 'C', backend: 'x', depends_on: ['a', 'b'] },
        ],
      })
      for (const t of [tasks[0], tasks[1]]) {
        store.transition(t.id, TaskStatus.IN_PROGRESS, { lease_owner: 'test' })
        store.transition(t.id, TaskStatus.REVIEW, { result: `{"from":"${t.summary}"}` })
        store.transition(t.id, TaskStatus.DONE)
      }
      const taskC = store.getById(tasks[2].id)!
      const upstream = getUpstreamResults(taskC, store)
      expect(Object.keys(upstream)).toHaveLength(2)
      expect(upstream[tasks[0].id]).toEqual({ from: 'A' })
      expect(upstream[tasks[1].id]).toEqual({ from: 'B' })
    })
  })
})
