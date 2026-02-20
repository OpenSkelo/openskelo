import { describe, it, expect } from 'vitest'
import { customGate } from '../src/gates/custom.js'
import type { GateResult } from '../src/types.js'

describe('custom gate', () => {
  // ── Sync functions ──

  describe('sync functions', () => {
    it('passes with sync function returning passed: true', async () => {
      const result = await customGate(
        { price: 42 },
        'raw output',
        {
          type: 'custom',
          fn: () => ({ gate: 'custom', passed: true, duration_ms: 0 }),
        },
      )
      expect(result.passed).toBe(true)
    })

    it('fails with sync function returning passed: false', async () => {
      const result = await customGate(
        { price: -1 },
        'raw',
        {
          type: 'custom',
          fn: (data) => ({
            gate: 'custom',
            passed: false,
            reason: `Price ${data.price} is negative`,
            duration_ms: 0,
          }),
        },
      )
      expect(result.passed).toBe(false)
      expect(result.reason).toContain('-1')
    })

    it('receives both data and raw arguments', async () => {
      let receivedData: any
      let receivedRaw: any

      await customGate(
        { a: 1 },
        'raw text',
        {
          type: 'custom',
          fn: (data, raw) => {
            receivedData = data
            receivedRaw = raw
            return { gate: 'custom', passed: true, duration_ms: 0 }
          },
        },
      )

      expect(receivedData).toEqual({ a: 1 })
      expect(receivedRaw).toBe('raw text')
    })
  })

  // ── Async functions ──

  describe('async functions', () => {
    it('passes with async function returning passed: true', async () => {
      const result = await customGate(
        {},
        'raw',
        {
          type: 'custom',
          fn: async () => ({ gate: 'custom', passed: true, duration_ms: 0 }),
        },
      )
      expect(result.passed).toBe(true)
    })

    it('fails with async function returning passed: false', async () => {
      const result = await customGate(
        {},
        'raw',
        {
          type: 'custom',
          fn: async () => ({
            gate: 'custom',
            passed: false,
            reason: 'Async check failed',
            duration_ms: 0,
          }),
        },
      )
      expect(result.passed).toBe(false)
      expect(result.reason).toContain('Async check failed')
    })
  })

  // ── Error handling ──

  describe('error handling', () => {
    it('fails gracefully when sync function throws', async () => {
      const result = await customGate(
        {},
        'raw',
        {
          type: 'custom',
          fn: () => { throw new Error('Boom!') },
        },
      )
      expect(result.passed).toBe(false)
      expect(result.reason).toContain('Boom!')
    })

    it('fails gracefully when async function rejects', async () => {
      const result = await customGate(
        {},
        'raw',
        {
          type: 'custom',
          fn: async () => { throw new Error('Async boom!') },
        },
      )
      expect(result.passed).toBe(false)
      expect(result.reason).toContain('Async boom!')
    })
  })

  // ── Metadata ──

  describe('metadata', () => {
    it('uses custom name', async () => {
      const result = await customGate(
        {},
        'raw',
        {
          type: 'custom',
          fn: () => ({ gate: 'ignored', passed: true, duration_ms: 0 }),
          name: 'my validation',
        },
      )
      expect(result.gate).toBe('my validation')
    })

    it('tracks duration_ms (wrapping user function time)', async () => {
      const result = await customGate(
        {},
        'raw',
        {
          type: 'custom',
          fn: () => ({ gate: 'custom', passed: true, duration_ms: 0 }),
        },
      )
      expect(typeof result.duration_ms).toBe('number')
      expect(result.duration_ms).toBeGreaterThanOrEqual(0)
    })
  })
})
