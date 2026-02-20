import { describe, expect, it } from 'vitest'
import { evaluateCustomGate } from '../src/gates/custom.js'

describe('custom gate', () => {
  it('passes with sync boolean true', async () => {
    const result = await evaluateCustomGate({ type: 'custom', fn: () => true }, { a: 1 })
    expect(result.passed).toBe(true)
  })

  it('fails with sync boolean false', async () => {
    const result = await evaluateCustomGate({ type: 'custom', fn: () => false }, { a: 1 })
    expect(result.passed).toBe(false)
  })

  it('passes with async boolean true', async () => {
    const result = await evaluateCustomGate({ type: 'custom', fn: async () => true }, {})
    expect(result.passed).toBe(true)
  })

  it('fails with async boolean false', async () => {
    const result = await evaluateCustomGate({ type: 'custom', fn: async () => false }, {})
    expect(result.passed).toBe(false)
  })

  it('passes with GateResult-like object', async () => {
    const result = await evaluateCustomGate({
      type: 'custom',
      fn: () => ({ gate: 'inner', passed: true, duration_ms: 0 })
    }, {})
    expect(result.passed).toBe(true)
  })

  it('fails with GateResult-like object', async () => {
    const result = await evaluateCustomGate({
      type: 'custom',
      fn: () => ({ gate: 'inner', passed: false, reason: 'bad', duration_ms: 0 })
    }, {})
    expect(result.passed).toBe(false)
    expect(result.reason).toBe('bad')
  })

  it('catches thrown sync errors', async () => {
    const result = await evaluateCustomGate({ type: 'custom', fn: () => { throw new Error('boom') } }, {})
    expect(result.passed).toBe(false)
    expect(result.reason).toContain('boom')
  })

  it('catches thrown async errors', async () => {
    const result = await evaluateCustomGate({ type: 'custom', fn: async () => { throw new Error('nope') } }, {})
    expect(result.passed).toBe(false)
    expect(result.reason).toContain('nope')
  })

  it('fails on invalid return type', async () => {
    const result = await evaluateCustomGate({ type: 'custom', fn: () => 'invalid' as unknown as boolean }, {})
    expect(result.passed).toBe(false)
    expect(result.reason).toContain('invalid result')
  })

  it('uses gate name when provided', async () => {
    const result = await evaluateCustomGate({ type: 'custom', name: 'my-custom', fn: () => true }, {})
    expect(result.gate).toBe('my-custom')
  })
})
