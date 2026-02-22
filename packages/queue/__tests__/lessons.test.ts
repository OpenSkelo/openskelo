import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { createDatabase } from '../src/db.js'
import { LessonStore, parseLessonOutput, buildLessonPrompt } from '../src/lessons.js'
import type { CreateLessonInput } from '../src/lessons.js'
import type Database from 'better-sqlite3'

describe('LessonStore', () => {
  let db: Database.Database
  let store: LessonStore

  beforeEach(() => {
    db = createDatabase(':memory:')
    store = new LessonStore(db)
  })

  afterEach(() => {
    db.close()
  })

  it('creates and retrieves a lesson', () => {
    const input: CreateLessonInput = {
      rule: 'Always validate input before processing',
      category: 'validation',
      severity: 'high',
    }
    const lesson = store.create(input)

    expect(lesson.id).toBeDefined()
    expect(lesson.rule).toBe(input.rule)
    expect(lesson.category).toBe('validation')
    expect(lesson.severity).toBe('high')
    expect(lesson.times_applied).toBe(0)
    expect(lesson.created_at).toBeDefined()

    const retrieved = store.getById(lesson.id)
    expect(retrieved).toEqual(lesson)
  })

  it('defaults severity to medium', () => {
    const lesson = store.create({ rule: 'Test rule', category: 'testing' })
    expect(lesson.severity).toBe('medium')
  })

  it('rejects invalid severity values', () => {
    expect(() => store.create({
      rule: 'Test rule',
      category: 'testing',
      severity: 'urgent',
    })).toThrow('Invalid lesson severity')
  })

  it('stores source_task_id and source_fix_id', () => {
    const lesson = store.create({
      rule: 'Check errors',
      category: 'error-handling',
      source_task_id: 'task-123',
      source_fix_id: 'fix-456',
    })
    expect(lesson.source_task_id).toBe('task-123')
    expect(lesson.source_fix_id).toBe('fix-456')
  })

  it('lists lessons with optional category filter', () => {
    store.create({ rule: 'Rule A', category: 'security' })
    store.create({ rule: 'Rule B', category: 'testing' })
    store.create({ rule: 'Rule C', category: 'security' })

    const all = store.list()
    expect(all).toHaveLength(3)

    const secOnly = store.list({ category: 'security' })
    expect(secOnly).toHaveLength(2)
    expect(secOnly.every(l => l.category === 'security')).toBe(true)
  })

  it('lists with limit', () => {
    store.create({ rule: 'R1', category: 'a' })
    store.create({ rule: 'R2', category: 'a' })
    store.create({ rule: 'R3', category: 'a' })

    const limited = store.list({ limit: 2 })
    expect(limited).toHaveLength(2)
  })

  it('searches by keyword in rule text', () => {
    store.create({ rule: 'Always validate JSON input', category: 'validation' })
    store.create({ rule: 'Use error boundaries in React', category: 'error-handling' })
    store.create({ rule: 'Always sanitize user input', category: 'security' })

    const results = store.search('input')
    expect(results).toHaveLength(2)

    const results2 = store.search('validate')
    expect(results2).toHaveLength(1)
    expect(results2[0].rule).toContain('validate')
  })

  it('returns empty for search with no words', () => {
    store.create({ rule: 'Some rule', category: 'test' })
    expect(store.search('')).toEqual([])
  })

  it('increments times_applied', () => {
    const lesson = store.create({ rule: 'Test', category: 'test' })
    expect(lesson.times_applied).toBe(0)

    store.incrementApplied(lesson.id)
    store.incrementApplied(lesson.id)

    const updated = store.getById(lesson.id)!
    expect(updated.times_applied).toBe(2)
  })

  it('deletes a lesson', () => {
    const lesson = store.create({ rule: 'Delete me', category: 'test' })
    expect(store.delete(lesson.id)).toBe(true)
    expect(store.getById(lesson.id)).toBeNull()
  })

  it('returns false for deleting non-existent lesson', () => {
    expect(store.delete('nonexistent')).toBe(false)
  })

  it('returns null for non-existent getById', () => {
    expect(store.getById('nope')).toBeNull()
  })

  describe('getRelevant', () => {
    it('returns lessons matching task keywords', () => {
      store.create({ rule: 'Always validate authentication tokens', category: 'security', severity: 'critical' })
      store.create({ rule: 'Use database transactions for writes', category: 'architecture' })
      store.create({ rule: 'Escape HTML in user output', category: 'security' })

      const relevant = store.getRelevant('validate user authentication', 5)
      expect(relevant.length).toBeGreaterThan(0)
      // The authentication+validate rule should be top scored
      expect(relevant[0].rule).toContain('authentication')
    })

    it('returns top N by limit', () => {
      store.create({ rule: 'Always validate input before processing', category: 'validation' })
      store.create({ rule: 'Check return values for errors', category: 'error-handling' })
      store.create({ rule: 'Validate form data on submit', category: 'validation' })

      const relevant = store.getRelevant('validate input data', 1)
      expect(relevant).toHaveLength(1)
    })

    it('falls back to list when no keywords extracted', () => {
      store.create({ rule: 'Rule A', category: 'a' })
      store.create({ rule: 'Rule B', category: 'b' })

      // Prompt with only stop words
      const relevant = store.getRelevant('the and or', 5)
      expect(relevant).toHaveLength(2)
    })

    it('returns empty when store is empty and keywords present', () => {
      const relevant = store.getRelevant('validate input', 5)
      expect(relevant).toEqual([])
    })

    it('scores severity higher', () => {
      store.create({ rule: 'Use error handling for network calls', category: 'error-handling', severity: 'low' })
      store.create({ rule: 'Always handle error responses properly', category: 'error-handling', severity: 'critical' })

      const relevant = store.getRelevant('handle error', 5)
      expect(relevant).toHaveLength(2)
      // Critical should be ranked higher
      expect(relevant[0].severity).toBe('critical')
    })
  })
})

describe('parseLessonOutput', () => {
  it('parses valid JSON lesson', () => {
    const output = JSON.stringify({
      rule: 'Always check return values',
      category: 'error-handling',
      severity: 'high',
    })
    const result = parseLessonOutput(output)
    expect(result).not.toBeNull()
    expect(result!.rule).toBe('Always check return values')
    expect(result!.category).toBe('error-handling')
    expect(result!.severity).toBe('high')
  })

  it('parses from markdown code block', () => {
    const output = 'Here is the lesson:\n```json\n{"rule":"Test rule","category":"testing","severity":"medium"}\n```\nDone.'
    const result = parseLessonOutput(output)
    expect(result).not.toBeNull()
    expect(result!.rule).toBe('Test rule')
  })

  it('defaults severity to medium', () => {
    const output = JSON.stringify({ rule: 'Some rule', category: 'testing' })
    const result = parseLessonOutput(output)
    expect(result!.severity).toBe('medium')
  })

  it('normalizes unknown severity to medium', () => {
    const output = JSON.stringify({ rule: 'Some rule', category: 'testing', severity: 'urgent' })
    const result = parseLessonOutput(output)
    expect(result!.severity).toBe('medium')
  })

  it('returns null for invalid JSON', () => {
    expect(parseLessonOutput('not json at all')).toBeNull()
  })

  it('returns null for missing rule field', () => {
    expect(parseLessonOutput(JSON.stringify({ category: 'test' }))).toBeNull()
  })

  it('returns null for missing category field', () => {
    expect(parseLessonOutput(JSON.stringify({ rule: 'test' }))).toBeNull()
  })
})

describe('buildLessonPrompt', () => {
  it('includes all sections', () => {
    const prompt = buildLessonPrompt(
      { summary: 'Fix auth', prompt: 'Fix the auth bug', result: 'did the fix' },
      { result: 'applied the fix correctly' },
      [{ what: 'missing validation', where: 'auth.ts', fix: 'add check' }],
    )

    expect(prompt).toContain('Fix auth')
    expect(prompt).toContain('Fix the auth bug')
    expect(prompt).toContain('did the fix')
    expect(prompt).toContain('applied the fix correctly')
    expect(prompt).toContain('missing validation')
    expect(prompt).toContain('Extract ONE concise, actionable rule')
  })

  it('handles null results', () => {
    const prompt = buildLessonPrompt(
      { summary: 'Task', prompt: 'Do it', result: null },
      { result: null },
      [],
    )

    expect(prompt).toContain('(no result)')
  })
})
