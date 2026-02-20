import { describe, it, expect } from 'vitest'
import { wordCountGate } from '../src/gates/word-count.js'

describe('word_count gate', () => {
  it('passes when word count is within min/max range', async () => {
    const result = await wordCountGate(
      'one two three four five',
      { type: 'word_count', min: 3, max: 10 },
    )
    expect(result.passed).toBe(true)
    expect(result.gate).toBe('word_count')
  })

  it('fails when word count is below min', async () => {
    const result = await wordCountGate(
      'one two',
      { type: 'word_count', min: 5 },
    )
    expect(result.passed).toBe(false)
    expect(result.reason).toContain('2')
    expect(result.reason).toMatch(/min|below|fewer/i)
  })

  it('fails when word count exceeds max', async () => {
    const result = await wordCountGate(
      'one two three four five six seven eight nine ten',
      { type: 'word_count', max: 5 },
    )
    expect(result.passed).toBe(false)
    expect(result.reason).toMatch(/max|above|exceeds/i)
  })

  it('passes with min only (no max)', async () => {
    const result = await wordCountGate(
      'one two three four five six seven',
      { type: 'word_count', min: 3 },
    )
    expect(result.passed).toBe(true)
  })

  it('passes with max only (no min)', async () => {
    const result = await wordCountGate(
      'one two three',
      { type: 'word_count', max: 10 },
    )
    expect(result.passed).toBe(true)
  })

  it('passes at exact min boundary', async () => {
    const result = await wordCountGate(
      'one two three',
      { type: 'word_count', min: 3 },
    )
    expect(result.passed).toBe(true)
  })

  it('passes at exact max boundary', async () => {
    const result = await wordCountGate(
      'one two three',
      { type: 'word_count', max: 3 },
    )
    expect(result.passed).toBe(true)
  })

  it('handles empty string', async () => {
    const result = await wordCountGate(
      '',
      { type: 'word_count', min: 1 },
    )
    expect(result.passed).toBe(false)
    expect(result.details?.count).toBe(0)
  })

  it('handles single word', async () => {
    const result = await wordCountGate(
      'hello',
      { type: 'word_count', min: 1, max: 1 },
    )
    expect(result.passed).toBe(true)
  })

  it('passes with no min and no max (always passes)', async () => {
    const result = await wordCountGate(
      'anything goes here',
      { type: 'word_count' },
    )
    expect(result.passed).toBe(true)
  })

  it('uses custom name', async () => {
    const result = await wordCountGate(
      'hello world',
      { type: 'word_count', min: 1, name: 'length check' },
    )
    expect(result.gate).toBe('length check')
  })

  it('tracks duration_ms', async () => {
    const result = await wordCountGate(
      'hello world',
      { type: 'word_count', min: 1 },
    )
    expect(typeof result.duration_ms).toBe('number')
    expect(result.duration_ms).toBeGreaterThanOrEqual(0)
  })

  it('includes word count in details', async () => {
    const result = await wordCountGate(
      'one two three',
      { type: 'word_count', min: 1 },
    )
    expect(result.details?.count).toBe(3)
  })

  it('handles extra whitespace correctly', async () => {
    const result = await wordCountGate(
      '  one   two   three  ',
      { type: 'word_count', min: 3, max: 3 },
    )
    expect(result.passed).toBe(true)
    expect(result.details?.count).toBe(3)
  })
})
