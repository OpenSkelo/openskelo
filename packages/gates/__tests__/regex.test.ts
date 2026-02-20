import { describe, expect, it } from 'vitest'
import { evaluateRegexGate } from '../src/gates/regex.js'

describe('regex gate', () => {
  it('passes when pattern matches', () => {
    const result = evaluateRegexGate({ type: 'regex', pattern: 'hello' }, 'hello world')
    expect(result.passed).toBe(true)
  })

  it('fails when pattern does not match', () => {
    const result = evaluateRegexGate({ type: 'regex', pattern: 'hello' }, 'goodbye')
    expect(result.passed).toBe(false)
  })

  it('supports invert mode pass', () => {
    const result = evaluateRegexGate({ type: 'regex', pattern: 'forbidden', invert: true }, 'allowed text')
    expect(result.passed).toBe(true)
  })

  it('supports invert mode fail', () => {
    const result = evaluateRegexGate({ type: 'regex', pattern: 'forbidden', invert: true }, 'forbidden text')
    expect(result.passed).toBe(false)
  })

  it('supports i flag', () => {
    const result = evaluateRegexGate({ type: 'regex', pattern: '^hello$', flags: 'i' }, 'HELLO')
    expect(result.passed).toBe(true)
  })

  it('supports g flag', () => {
    const result = evaluateRegexGate({ type: 'regex', pattern: 'l', flags: 'g' }, 'hello')
    expect(result.passed).toBe(true)
  })

  it('supports m flag', () => {
    const result = evaluateRegexGate({ type: 'regex', pattern: '^world$', flags: 'm' }, 'hello\nworld')
    expect(result.passed).toBe(true)
  })

  it('handles invalid regex gracefully', () => {
    const result = evaluateRegexGate({ type: 'regex', pattern: '[' }, 'x')
    expect(result.passed).toBe(false)
    expect(result.reason).toContain('Invalid regex')
  })

  it('uses custom gate name', () => {
    const result = evaluateRegexGate({ type: 'regex', name: 'rx', pattern: 'x' }, 'x')
    expect(result.gate).toBe('rx')
  })

  it('works with serialized non-string input', () => {
    const result = evaluateRegexGate({ type: 'regex', pattern: '"id":1' }, { id: 1 })
    expect(result.passed).toBe(true)
  })

  it('returns details with matched true', () => {
    const result = evaluateRegexGate({ type: 'regex', pattern: 'abc' }, 'abc')
    expect((result.details as { matched: boolean }).matched).toBe(true)
  })

  it('returns details with matched false', () => {
    const result = evaluateRegexGate({ type: 'regex', pattern: 'abc' }, 'def')
    expect((result.details as { matched: boolean }).matched).toBe(false)
  })

  it('duration is recorded', () => {
    const result = evaluateRegexGate({ type: 'regex', pattern: 'x' }, 'x')
    expect(result.duration_ms).toBeGreaterThanOrEqual(0)
  })

  it('reports inversion failure reason', () => {
    const result = evaluateRegexGate({ type: 'regex', pattern: 'x', invert: true }, 'x')
    expect(result.reason).toContain('inversion')
  })

  it('accepts empty string input', () => {
    const result = evaluateRegexGate({ type: 'regex', pattern: '^$' }, '')
    expect(result.passed).toBe(true)
  })
})
