import { describe, expect, it } from 'vitest'
import { evaluateWordCountGate } from '../src/gates/word-count.js'

describe('word_count gate', () => {
  it('passes min only', () => {
    const result = evaluateWordCountGate({ type: 'word_count', min: 2 }, 'one two three')
    expect(result.passed).toBe(true)
  })

  it('fails min only', () => {
    const result = evaluateWordCountGate({ type: 'word_count', min: 4 }, 'one two three')
    expect(result.passed).toBe(false)
  })

  it('passes max only', () => {
    const result = evaluateWordCountGate({ type: 'word_count', max: 5 }, 'one two')
    expect(result.passed).toBe(true)
  })

  it('fails max only', () => {
    const result = evaluateWordCountGate({ type: 'word_count', max: 1 }, 'one two')
    expect(result.passed).toBe(false)
  })

  it('passes min and max range', () => {
    const result = evaluateWordCountGate({ type: 'word_count', min: 2, max: 4 }, 'one two three')
    expect(result.passed).toBe(true)
  })

  it('passes exact min boundary', () => {
    const result = evaluateWordCountGate({ type: 'word_count', min: 3 }, 'one two three')
    expect(result.passed).toBe(true)
  })

  it('passes exact max boundary', () => {
    const result = evaluateWordCountGate({ type: 'word_count', max: 3 }, 'one two three')
    expect(result.passed).toBe(true)
  })

  it('handles empty string', () => {
    const result = evaluateWordCountGate({ type: 'word_count', max: 0 }, '')
    expect(result.passed).toBe(true)
  })

  it('handles single word', () => {
    const result = evaluateWordCountGate({ type: 'word_count', min: 1, max: 1 }, 'solo')
    expect(result.passed).toBe(true)
  })

  it('handles multiline text', () => {
    const result = evaluateWordCountGate({ type: 'word_count', min: 4 }, 'line one\nline two')
    expect(result.passed).toBe(true)
  })
})
