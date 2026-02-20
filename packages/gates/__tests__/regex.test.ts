import { describe, it, expect } from 'vitest'
import { regexGate } from '../src/gates/regex.js'

describe('regex gate', () => {
  // ── Match mode ──

  describe('match mode', () => {
    it('passes when pattern matches', async () => {
      const result = await regexGate(
        'Hello, World!',
        { type: 'regex', pattern: 'Hello' },
      )
      expect(result.passed).toBe(true)
      expect(result.gate).toBe('regex')
    })

    it('fails when pattern does not match', async () => {
      const result = await regexGate(
        'Hello, World!',
        { type: 'regex', pattern: 'Goodbye' },
      )
      expect(result.passed).toBe(false)
      expect(result.reason).toBeDefined()
    })

    it('matches regex metacharacters', async () => {
      const result = await regexGate(
        'Price: $42.50',
        { type: 'regex', pattern: '\\$\\d+\\.\\d+' },
      )
      expect(result.passed).toBe(true)
    })

    it('matches anchored patterns', async () => {
      const result = await regexGate(
        '# My Title',
        { type: 'regex', pattern: '^#' },
      )
      expect(result.passed).toBe(true)
    })

    it('fails anchored pattern on non-matching input', async () => {
      const result = await regexGate(
        'No title here',
        { type: 'regex', pattern: '^#' },
      )
      expect(result.passed).toBe(false)
    })
  })

  // ── Flags ──

  describe('flags', () => {
    it('is case-sensitive by default', async () => {
      const result = await regexGate(
        'hello',
        { type: 'regex', pattern: 'Hello' },
      )
      expect(result.passed).toBe(false)
    })

    it('supports case-insensitive flag', async () => {
      const result = await regexGate(
        'hello',
        { type: 'regex', pattern: 'Hello', flags: 'i' },
      )
      expect(result.passed).toBe(true)
    })

    it('supports multiline flag', async () => {
      const result = await regexGate(
        'line 1\n# heading\nline 3',
        { type: 'regex', pattern: '^# heading$', flags: 'm' },
      )
      expect(result.passed).toBe(true)
    })

    it('supports dotall flag', async () => {
      const result = await regexGate(
        'start\nmiddle\nend',
        { type: 'regex', pattern: 'start.*end', flags: 's' },
      )
      expect(result.passed).toBe(true)
    })
  })

  // ── Invert mode ──

  describe('invert mode', () => {
    it('passes when pattern does NOT match (blocklist)', async () => {
      const result = await regexGate(
        'This is clean output',
        { type: 'regex', pattern: 'ERROR|FATAL', invert: true },
      )
      expect(result.passed).toBe(true)
    })

    it('fails when pattern DOES match in invert mode', async () => {
      const result = await regexGate(
        'ERROR: something went wrong',
        { type: 'regex', pattern: 'ERROR|FATAL', invert: true },
      )
      expect(result.passed).toBe(false)
    })
  })

  // ── Error handling ──

  describe('error handling', () => {
    it('fails gracefully on invalid regex pattern', async () => {
      const result = await regexGate(
        'some text',
        { type: 'regex', pattern: '[invalid' },
      )
      expect(result.passed).toBe(false)
      expect(result.reason).toMatch(/invalid|error/i)
    })

    it('handles empty string input', async () => {
      const result = await regexGate(
        '',
        { type: 'regex', pattern: '.' },
      )
      expect(result.passed).toBe(false)
    })
  })

  // ── Metadata ──

  describe('metadata', () => {
    it('uses custom name', async () => {
      const result = await regexGate(
        'test',
        { type: 'regex', pattern: 'test', name: 'has test' },
      )
      expect(result.gate).toBe('has test')
    })

    it('tracks duration_ms', async () => {
      const result = await regexGate(
        'test',
        { type: 'regex', pattern: 'test' },
      )
      expect(typeof result.duration_ms).toBe('number')
      expect(result.duration_ms).toBeGreaterThanOrEqual(0)
    })
  })
})
