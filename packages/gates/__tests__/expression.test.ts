import { describe, it, expect } from 'vitest'
import { expressionGate } from '../src/gates/expression.js'
import { safeEval } from '../src/utils/safe-eval.js'

describe('expression gate', () => {
  // ── Arithmetic ──

  describe('arithmetic expressions', () => {
    it('evaluates simple comparison', async () => {
      const result = await expressionGate(
        { price: 42 },
        { type: 'expression', expr: 'price > 0' },
      )
      expect(result.passed).toBe(true)
    })

    it('evaluates multiplication', async () => {
      const result = await expressionGate(
        { price: 45 },
        { type: 'expression', expr: 'price * 1.1 < 50' },
      )
      expect(result.passed).toBe(true)
    })

    it('evaluates addition', async () => {
      const result = await expressionGate(
        { a: 10, b: 20 },
        { type: 'expression', expr: 'a + b === 30' },
      )
      expect(result.passed).toBe(true)
    })

    it('evaluates division', async () => {
      const result = await expressionGate(
        { total: 100, count: 4 },
        { type: 'expression', expr: 'total / count === 25' },
      )
      expect(result.passed).toBe(true)
    })

    it('evaluates modulo', async () => {
      const result = await expressionGate(
        { value: 10 },
        { type: 'expression', expr: 'value % 3 === 1' },
      )
      expect(result.passed).toBe(true)
    })
  })

  // ── Comparison ──

  describe('comparison expressions', () => {
    it('evaluates less than', async () => {
      const result = await expressionGate(
        { price: 5 },
        { type: 'expression', expr: 'price < 10' },
      )
      expect(result.passed).toBe(true)
    })

    it('evaluates greater than or equal', async () => {
      const result = await expressionGate(
        { score: 80 },
        { type: 'expression', expr: 'score >= 80' },
      )
      expect(result.passed).toBe(true)
    })

    it('evaluates strict equality', async () => {
      const result = await expressionGate(
        { status: 'active' },
        { type: 'expression', expr: "status === 'active'" },
      )
      expect(result.passed).toBe(true)
    })

    it('evaluates strict inequality', async () => {
      const result = await expressionGate(
        { status: 'active' },
        { type: 'expression', expr: "status !== 'error'" },
      )
      expect(result.passed).toBe(true)
    })

    it('fails when comparison is false', async () => {
      const result = await expressionGate(
        { price: 15000 },
        { type: 'expression', expr: 'price > 0 && price < 10000' },
      )
      expect(result.passed).toBe(false)
    })
  })

  // ── Logical operators ──

  describe('logical expressions', () => {
    it('evaluates AND', async () => {
      const result = await expressionGate(
        { price: 50, rating: 'buy' },
        { type: 'expression', expr: "price > 0 && rating === 'buy'" },
      )
      expect(result.passed).toBe(true)
    })

    it('evaluates OR', async () => {
      const result = await expressionGate(
        { rating: 'sell' },
        { type: 'expression', expr: "rating === 'buy' || rating === 'sell'" },
      )
      expect(result.passed).toBe(true)
    })

    it('evaluates NOT', async () => {
      const result = await expressionGate(
        { active: false },
        { type: 'expression', expr: '!active' },
      )
      expect(result.passed).toBe(true)
    })

    it('evaluates complex logical', async () => {
      const result = await expressionGate(
        { price: 50, quantity: 10, active: true },
        { type: 'expression', expr: 'active && price > 0 && quantity >= 10' },
      )
      expect(result.passed).toBe(true)
    })
  })

  // ── Property access ──

  describe('property access', () => {
    it('accesses nested properties', async () => {
      const result = await expressionGate(
        { meta: { author: 'Alice', version: 2 } },
        { type: 'expression', expr: 'meta.version >= 2' },
      )
      expect(result.passed).toBe(true)
    })

    it('accesses deeply nested properties', async () => {
      const result = await expressionGate(
        { a: { b: { c: 42 } } },
        { type: 'expression', expr: 'a.b.c === 42' },
      )
      expect(result.passed).toBe(true)
    })

    it('accesses array.length', async () => {
      const result = await expressionGate(
        { sources: ['a', 'b', 'c'] },
        { type: 'expression', expr: 'sources.length >= 2' },
      )
      expect(result.passed).toBe(true)
    })

    it('evaluates string equality', async () => {
      const result = await expressionGate(
        { name: 'hello world' },
        { type: 'expression', expr: "name === 'hello world'" },
      )
      expect(result.passed).toBe(true)
    })

    it('fails on undefined property access gracefully', async () => {
      const result = await expressionGate(
        { price: 42 },
        { type: 'expression', expr: 'sources.length >= 2' },
      )
      expect(result.passed).toBe(false)
      expect(result.reason).toBeDefined()
    })
  })

  // ── Security tests ──

  describe('security — blocked expressions', () => {
    it('blocks process access', async () => {
      const result = await expressionGate(
        { x: 1 },
        { type: 'expression', expr: 'process.exit(1)' },
      )
      expect(result.passed).toBe(false)
      expect(result.reason).toMatch(/blocked|forbidden|denied|unsafe/i)
    })

    it('blocks require', async () => {
      const result = await expressionGate(
        { x: 1 },
        { type: 'expression', expr: "require('fs')" },
      )
      expect(result.passed).toBe(false)
      expect(result.reason).toMatch(/blocked|forbidden|denied|unsafe/i)
    })

    it('blocks import', async () => {
      const result = await expressionGate(
        { x: 1 },
        { type: 'expression', expr: "import('fs')" },
      )
      expect(result.passed).toBe(false)
      expect(result.reason).toMatch(/blocked|forbidden|denied|unsafe/i)
    })

    it('blocks eval', async () => {
      const result = await expressionGate(
        { x: 1 },
        { type: 'expression', expr: "eval('1+1')" },
      )
      expect(result.passed).toBe(false)
      expect(result.reason).toMatch(/blocked|forbidden|denied|unsafe/i)
    })

    it('blocks Function constructor', async () => {
      const result = await expressionGate(
        { x: 1 },
        { type: 'expression', expr: "Function('return 1')()" },
      )
      expect(result.passed).toBe(false)
      expect(result.reason).toMatch(/blocked|forbidden|denied|unsafe/i)
    })

    it('blocks fetch', async () => {
      const result = await expressionGate(
        { x: 1 },
        { type: 'expression', expr: "fetch('http://evil.com')" },
      )
      expect(result.passed).toBe(false)
      expect(result.reason).toMatch(/blocked|forbidden|denied|unsafe/i)
    })

    it('blocks globalThis', async () => {
      const result = await expressionGate(
        { x: 1 },
        { type: 'expression', expr: 'globalThis.process' },
      )
      expect(result.passed).toBe(false)
      expect(result.reason).toMatch(/blocked|forbidden|denied|unsafe/i)
    })

    it('blocks constructor access', async () => {
      const result = await expressionGate(
        { x: 1 },
        { type: 'expression', expr: "x.constructor.constructor('return process')()" },
      )
      expect(result.passed).toBe(false)
      expect(result.reason).toMatch(/blocked|forbidden|denied|unsafe/i)
    })
  })

  // ── Edge cases ──

  describe('edge cases', () => {
    it('uses custom name in gate result', async () => {
      const result = await expressionGate(
        { price: 42 },
        { type: 'expression', expr: 'price > 0', name: 'price positive' },
      )
      expect(result.gate).toBe('price positive')
    })

    it('tracks duration_ms', async () => {
      const result = await expressionGate(
        { x: 1 },
        { type: 'expression', expr: 'x === 1' },
      )
      expect(typeof result.duration_ms).toBe('number')
      expect(result.duration_ms).toBeGreaterThanOrEqual(0)
    })

    it('reports expression in failure reason', async () => {
      const result = await expressionGate(
        { price: -5 },
        { type: 'expression', expr: 'price > 0' },
      )
      expect(result.passed).toBe(false)
      expect(result.reason).toContain('price > 0')
    })
  })
})

// ── safe-eval unit tests ──

describe('safeEval', () => {
  it('evaluates basic arithmetic', () => {
    expect(safeEval('2 + 3', {})).toBe(5)
  })

  it('accesses context variables', () => {
    expect(safeEval('x * 2', { x: 21 })).toBe(42)
  })

  it('throws on blocked tokens', () => {
    expect(() => safeEval('process.exit(1)', {})).toThrow()
    expect(() => safeEval("require('fs')", {})).toThrow()
    expect(() => safeEval("eval('bad')", {})).toThrow()
  })

  it('throws on bracket notation', () => {
    expect(() => safeEval('sources[0] === 1', { sources: [1] })).toThrow()
  })
})
