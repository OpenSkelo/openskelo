import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { createDatabase } from '../src/db.js'
import { TaskStore } from '../src/task-store.js'
import { TaskStatus } from '../src/state-machine.js'
import {
  createPipeline,
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
  })
})
