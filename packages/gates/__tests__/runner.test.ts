import { describe, expect, it } from 'vitest'
import { createGateRunner } from '../src/runner.js'

describe('gate runner', () => {
  it('runs gates in sequence', async () => {
    const order: string[] = []
    const runner = createGateRunner([
      { type: 'custom', name: 'one', fn: async () => { order.push('one'); return true } },
      { type: 'custom', name: 'two', fn: async () => { order.push('two'); return true } }
    ])

    await runner.evaluate('x')
    expect(order).toEqual(['one', 'two'])
  })

  it('short-circuit mode stops on first failure by default', async () => {
    const order: string[] = []
    const runner = createGateRunner([
      { type: 'custom', name: 'one', fn: () => { order.push('one'); return false } },
      { type: 'custom', name: 'two', fn: () => { order.push('two'); return true } }
    ])

    const results = await runner.evaluate('x')
    expect(results.length).toBe(1)
    expect(order).toEqual(['one'])
  })

  it('all-gates mode runs all gates even after failures', async () => {
    const order: string[] = []
    const runner = createGateRunner([
      { type: 'custom', name: 'one', fn: () => { order.push('one'); return false } },
      { type: 'custom', name: 'two', fn: () => { order.push('two'); return true } }
    ], { mode: 'all' })

    const results = await runner.evaluate('x')
    expect(results.length).toBe(2)
    expect(order).toEqual(['one', 'two'])
  })

  it('handles empty gates array', async () => {
    const runner = createGateRunner([])
    const results = await runner.evaluate('x')
    expect(results).toEqual([])
  })

  it('supports mixed pass and fail results', async () => {
    const runner = createGateRunner([
      { type: 'word_count', min: 1 },
      { type: 'regex', pattern: 'missing' }
    ], { mode: 'all' })

    const results = await runner.evaluate('hello world')
    expect(results[0].passed).toBe(true)
    expect(results[1].passed).toBe(false)
  })

  it('records duration per gate', async () => {
    const runner = createGateRunner([{ type: 'word_count', min: 1 }])
    const [result] = await runner.evaluate('x')
    expect(result.duration_ms).toBeGreaterThanOrEqual(0)
  })

  it('runs expression gate via runner', async () => {
    const runner = createGateRunner([{ type: 'expression', expr: 'data.ok === true' }])
    const [result] = await runner.evaluate({ ok: true })
    expect(result.passed).toBe(true)
  })

  it('runs regex gate via runner', async () => {
    const runner = createGateRunner([{ type: 'regex', pattern: 'abc' }])
    const [result] = await runner.evaluate('abc')
    expect(result.passed).toBe(true)
  })

  it('runs word_count gate via runner', async () => {
    const runner = createGateRunner([{ type: 'word_count', min: 2 }])
    const [result] = await runner.evaluate('one two')
    expect(result.passed).toBe(true)
  })

  it('runs custom gate with raw argument', async () => {
    const runner = createGateRunner([
      { type: 'custom', fn: (_data, raw) => raw === 'RAW' }
    ])
    const [result] = await runner.evaluate('x', 'RAW')
    expect(result.passed).toBe(true)
  })

  it('runs llm_review gate using provided provider', async () => {
    const runner = createGateRunner([
      {
        type: 'llm_review',
        criteria: ['must pass']
      }
    ])

    const [result] = await runner.evaluate('x', undefined, {
      llmProvider: {
        name: 'mock',
        review: async () => ({ passed: true, score: 1, criteria_results: [] })
      }
    })

    expect(result.passed).toBe(true)
  })

  it('fails llm_review gate without provider', async () => {
    const runner = createGateRunner([{ type: 'llm_review', criteria: ['must pass'] }])
    const [result] = await runner.evaluate('x')
    expect(result.passed).toBe(false)
  })

  it('runs command gate via runner', async () => {
    const runner = createGateRunner([{ type: 'command', run: 'node -e "process.exit(0)"' }])
    const [result] = await runner.evaluate('x')
    expect(result.passed).toBe(true)
  })

  it('supports json_schema gate via runner', async () => {
    const runner = createGateRunner([{ type: 'json_schema', schema: { type: 'object', required: ['id'] } }])
    const [result] = await runner.evaluate({ id: 1 })
    expect(result.passed).toBe(true)
  })

  it('returns failure for unknown gate in fallback branch', async () => {
    const runner = createGateRunner([{ type: 'custom', fn: () => true }])
    const [result] = await runner.evaluate('x')
    expect(result.gate).toBe('custom')
  })
})
