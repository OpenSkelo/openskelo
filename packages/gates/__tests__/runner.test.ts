import { describe, it, expect } from 'vitest'
import { createGateRunner } from '../src/runner.js'

describe('createGateRunner', () => {
  // ── Basic evaluation ──

  describe('basic evaluation', () => {
    it('returns empty array for no gates', async () => {
      const runner = createGateRunner([])
      const results = await runner.evaluate({})
      expect(results).toEqual([])
    })

    it('runs a single passing gate', async () => {
      const runner = createGateRunner([
        { type: 'expression', expr: 'x === 1' },
      ])
      const results = await runner.evaluate({ x: 1 })
      expect(results).toHaveLength(1)
      expect(results[0].passed).toBe(true)
    })

    it('runs a single failing gate', async () => {
      const runner = createGateRunner([
        { type: 'expression', expr: 'x > 10' },
      ])
      const results = await runner.evaluate({ x: 1 })
      expect(results).toHaveLength(1)
      expect(results[0].passed).toBe(false)
    })

    it('runs multiple gates in sequence', async () => {
      const runner = createGateRunner([
        { type: 'json_schema', schema: { required: ['name'] } },
        { type: 'expression', expr: "name === 'Alice'" },
      ])
      const results = await runner.evaluate({ name: 'Alice' })
      expect(results).toHaveLength(2)
      expect(results.every((r) => r.passed)).toBe(true)
    })
  })

  // ── Short-circuit mode (default) ──

  describe('short-circuit mode', () => {
    it('stops on first failure by default', async () => {
      const runner = createGateRunner([
        { type: 'expression', expr: 'x > 10' },
        { type: 'expression', expr: 'x > 20' },
      ])
      const results = await runner.evaluate({ x: 1 })
      // Should stop after first failure
      expect(results).toHaveLength(1)
      expect(results[0].passed).toBe(false)
    })

    it('runs all gates when all pass in short-circuit mode', async () => {
      const runner = createGateRunner([
        { type: 'expression', expr: 'x > 0' },
        { type: 'expression', expr: 'x < 100' },
        { type: 'expression', expr: 'x === 42' },
      ])
      const results = await runner.evaluate({ x: 42 })
      expect(results).toHaveLength(3)
      expect(results.every((r) => r.passed)).toBe(true)
    })
  })

  // ── All-gates mode ──

  describe('all-gates mode', () => {
    it('runs all gates even after failures', async () => {
      const runner = createGateRunner([
        { type: 'expression', expr: 'x > 10' },
        { type: 'expression', expr: 'x > 20' },
        { type: 'expression', expr: 'x === 1' },
      ])
      const results = await runner.evaluate({ x: 1 }, undefined, { shortCircuit: false })
      expect(results).toHaveLength(3)
      expect(results[0].passed).toBe(false)
      expect(results[1].passed).toBe(false)
      expect(results[2].passed).toBe(true)
    })
  })

  // ── Mixed gate types ──

  describe('mixed gate types', () => {
    it('evaluates different gate types together', async () => {
      const runner = createGateRunner([
        { type: 'json_schema', schema: { required: ['text'] } },
        { type: 'word_count', min: 2 },
        { type: 'regex', pattern: 'hello' },
      ])
      const data = { text: 'hello world' }
      const results = await runner.evaluate(data, 'hello world')
      expect(results).toHaveLength(3)
      expect(results.every((r) => r.passed)).toBe(true)
    })

    it('uses data for schema/expression, raw for regex/word_count', async () => {
      const runner = createGateRunner([
        { type: 'json_schema', schema: { required: ['count'] } },
        { type: 'expression', expr: 'count > 0' },
        { type: 'regex', pattern: 'result' },
        { type: 'word_count', min: 1 },
      ])
      const data = { count: 5 }
      const raw = 'The result is 5'
      const results = await runner.evaluate(data, raw)
      expect(results).toHaveLength(4)
      expect(results.every((r) => r.passed)).toBe(true)
    })

    it('handles custom gate in runner', async () => {
      const runner = createGateRunner([
        {
          type: 'custom',
          fn: (data) => ({
            gate: 'custom',
            passed: data.valid === true,
            duration_ms: 0,
          }),
        },
      ])
      const results = await runner.evaluate({ valid: true })
      expect(results[0].passed).toBe(true)
    })
  })

  // ── Sequence order ──

  describe('sequence order', () => {
    it('preserves gate order in results', async () => {
      const runner = createGateRunner([
        { type: 'expression', expr: 'a === 1', name: 'first' },
        { type: 'expression', expr: 'b === 2', name: 'second' },
        { type: 'expression', expr: 'c === 3', name: 'third' },
      ])
      const results = await runner.evaluate({ a: 1, b: 2, c: 3 })
      expect(results.map((r) => r.gate)).toEqual(['first', 'second', 'third'])
    })
  })

  // ── Raw fallback ──

  describe('raw argument', () => {
    it('defaults raw to stringified data when not provided', async () => {
      const runner = createGateRunner([
        { type: 'word_count', min: 1 },
      ])
      const results = await runner.evaluate({ hello: 'world' })
      expect(results[0].passed).toBe(true)
    })
  })
})
