import { describe, it, expect } from 'vitest'
import { parseOutput } from '../src/utils/parse-output.js'

describe('parseOutput', () => {
  // ── Clean JSON ──

  describe('clean JSON', () => {
    it('parses clean JSON object', () => {
      const result = parseOutput('{"price": 42, "analysis": "bullish"}')
      expect(result).toEqual({ price: 42, analysis: 'bullish' })
    })

    it('parses clean JSON array', () => {
      const result = parseOutput('[1, 2, 3]')
      expect(result).toEqual([1, 2, 3])
    })

    it('handles whitespace around JSON', () => {
      const result = parseOutput('  \n  {"a": 1}  \n  ')
      expect(result).toEqual({ a: 1 })
    })
  })

  // ── Fenced JSON ──

  describe('fenced JSON', () => {
    it('extracts JSON from ```json code fence', () => {
      const input = 'Here is the result:\n```json\n{"price": 42}\n```\nDone.'
      const result = parseOutput(input)
      expect(result).toEqual({ price: 42 })
    })

    it('extracts JSON from ``` code fence (no language)', () => {
      const input = 'Result:\n```\n{"status": "ok"}\n```'
      const result = parseOutput(input)
      expect(result).toEqual({ status: 'ok' })
    })

    it('handles multiple code fences, takes first JSON block', () => {
      const input = '```json\n{"first": true}\n```\n\n```json\n{"second": true}\n```'
      const result = parseOutput(input)
      expect(result).toEqual({ first: true })
    })
  })

  // ── JSON with preamble ──

  describe('JSON with preamble', () => {
    it('extracts JSON object after preamble text', () => {
      const input = 'Here is my analysis:\n\n{"price": 42, "rating": "buy"}'
      const result = parseOutput(input)
      expect(result).toEqual({ price: 42, rating: 'buy' })
    })

    it('extracts JSON with trailing text', () => {
      const input = '{"data": true}\n\nHope this helps!'
      const result = parseOutput(input)
      expect(result).toEqual({ data: true })
    })
  })

  // ── No JSON found ──

  describe('no JSON found', () => {
    it('returns null when no JSON is present', () => {
      const result = parseOutput('Just plain text with no JSON')
      expect(result).toBeNull()
    })

    it('returns null for empty string', () => {
      const result = parseOutput('')
      expect(result).toBeNull()
    })

    it('returns null for invalid JSON', () => {
      const result = parseOutput('{invalid json}')
      expect(result).toBeNull()
    })
  })

  // ── Edge cases ──

  describe('edge cases', () => {
    it('handles nested objects', () => {
      const input = '```json\n{"meta": {"author": "AI", "nested": {"deep": true}}}\n```'
      const result = parseOutput(input)
      expect(result).toEqual({ meta: { author: 'AI', nested: { deep: true } } })
    })

    it('handles JSON with arrays inside objects', () => {
      const input = '{"sources": ["a", "b"], "count": 2}'
      const result = parseOutput(input)
      expect(result).toEqual({ sources: ['a', 'b'], count: 2 })
    })
  })
})
