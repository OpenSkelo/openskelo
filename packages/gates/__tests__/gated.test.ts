import { describe, it, expect, vi } from 'vitest'
import { gated } from '../src/gated.js'
import { GateExhaustionError } from '../src/types.js'
import type { AttemptEvent, RetryContext } from '../src/types.js'

describe('gated() public API', () => {
  // ── Happy path ──

  describe('happy path', () => {
    it('returns verified data on first pass', async () => {
      const result = await gated(
        async () => ({ price: 42, analysis: 'good' }),
        {
          gates: [
            { type: 'json_schema', schema: { required: ['price', 'analysis'] } },
            { type: 'expression', expr: 'price > 0' },
          ],
        },
      )
      expect(result.data).toEqual({ price: 42, analysis: 'good' })
      expect(result.attempts).toBe(1)
      expect(result.gates.every((g) => g.passed)).toBe(true)
    })

    it('includes history', async () => {
      const result = await gated(
        async () => ({ x: 1 }),
        { gates: [{ type: 'expression', expr: 'x === 1' }] },
      )
      expect(result.history).toHaveLength(1)
      expect(result.history[0].passed).toBe(true)
    })

    it('tracks duration_ms', async () => {
      const result = await gated(
        async () => ({ x: 1 }),
        { gates: [{ type: 'expression', expr: 'x === 1' }] },
      )
      expect(result.duration_ms).toBeGreaterThanOrEqual(0)
    })
  })

  // ── Retry path ──

  describe('retry path', () => {
    it('retries and succeeds on second attempt', async () => {
      let attempt = 0
      const result = await gated(
        async (ctx?: RetryContext) => {
          attempt++
          return { count: attempt }
        },
        {
          gates: [{ type: 'expression', expr: 'count >= 2' }],
          retry: { max: 3, feedback: true },
        },
      )
      expect(result.attempts).toBe(2)
      expect(result.data).toEqual({ count: 2 })
    })

    it('passes feedback to producer on retry', async () => {
      let receivedFeedback: string | undefined
      let attempt = 0

      await gated(
        async (ctx?: RetryContext) => {
          attempt++
          if (ctx) receivedFeedback = ctx.feedback
          return { val: attempt >= 2 ? 100 : 0 }
        },
        {
          gates: [{ type: 'expression', expr: 'val > 50' }],
          retry: { max: 3, feedback: true },
        },
      )

      expect(receivedFeedback).toBeDefined()
      expect(receivedFeedback).toContain('val > 50')
    })
  })

  // ── Exhaustion ──

  describe('exhaustion', () => {
    it('throws GateExhaustionError when all retries fail', async () => {
      await expect(
        gated(
          async () => ({ x: 0 }),
          {
            gates: [{ type: 'expression', expr: 'x > 100' }],
            retry: { max: 2, feedback: true },
          },
        ),
      ).rejects.toThrow(GateExhaustionError)
    })

    it('error includes full history', async () => {
      try {
        await gated(
          async () => ({ x: 0 }),
          {
            gates: [{ type: 'expression', expr: 'x > 100' }],
            retry: { max: 3, feedback: true },
          },
        )
        expect.fail('Should throw')
      } catch (err) {
        const e = err as GateExhaustionError
        expect(e.history).toHaveLength(3)
      }
    })
  })

  // ── Extract modes ──

  describe('extract modes', () => {
    it('extract: json parses JSON from string output', async () => {
      const result = await gated(
        async () => '{"price": 42}',
        {
          gates: [{ type: 'expression', expr: 'price > 0' }],
          extract: 'json',
        },
      )
      expect(result.data).toEqual({ price: 42 })
    })

    it('extract: json handles code-fenced output', async () => {
      const result = await gated(
        async () => 'Here is the result:\n```json\n{"status": "ok"}\n```',
        {
          gates: [{ type: 'expression', expr: "status === 'ok'" }],
          extract: 'json',
        },
      )
      expect(result.data).toEqual({ status: 'ok' })
    })

    it('extract: text returns raw string', async () => {
      const result = await gated(
        async () => 'hello world',
        {
          gates: [{ type: 'word_count', min: 1 }],
          extract: 'text',
        },
      )
      expect(result.data).toBe('hello world')
    })

    it('extract: auto detects JSON from string', async () => {
      const result = await gated(
        async () => '{"x": 1}',
        {
          gates: [{ type: 'expression', expr: 'x === 1' }],
          extract: 'auto',
        },
      )
      expect(result.data).toEqual({ x: 1 })
    })

    it('extract: auto passes through objects', async () => {
      const result = await gated(
        async () => ({ x: 1 }),
        {
          gates: [{ type: 'expression', expr: 'x === 1' }],
          extract: 'auto',
        },
      )
      expect(result.data).toEqual({ x: 1 })
    })

    it('extract: custom function', async () => {
      const result = await gated(
        async () => 'PRICE:42',
        {
          gates: [{ type: 'expression', expr: 'price === 42' }],
          extract: (raw: string) => ({ price: parseInt(raw.split(':')[1]) }),
        },
      )
      expect(result.data).toEqual({ price: 42 })
    })
  })

  // ── onAttempt callback ──

  describe('onAttempt callback', () => {
    it('calls onAttempt after each attempt', async () => {
      const events: AttemptEvent[] = []
      let attempt = 0

      await gated(
        async () => {
          attempt++
          return { v: attempt }
        },
        {
          gates: [{ type: 'expression', expr: 'v >= 2' }],
          retry: { max: 3, feedback: true },
          onAttempt: (e) => events.push(e),
        },
      )

      expect(events).toHaveLength(2)
      expect(events[0].attempt).toBe(1)
      expect(events[0].passed).toBe(false)
      expect(events[1].attempt).toBe(2)
      expect(events[1].passed).toBe(true)
    })
  })

  // ── Default behavior ──

  describe('defaults', () => {
    it('defaults to auto extract', async () => {
      const result = await gated(
        async () => ({ x: 1 }),
        { gates: [{ type: 'expression', expr: 'x === 1' }] },
      )
      expect(result.data).toEqual({ x: 1 })
    })

    it('defaults to max: 3 retries', async () => {
      let attempts = 0
      try {
        await gated(
          async () => {
            attempts++
            return { x: 0 }
          },
          { gates: [{ type: 'expression', expr: 'x > 100' }] },
        )
      } catch {
        // expected
      }
      expect(attempts).toBe(3)
    })
  })

  // ── No gates ──

  describe('edge cases', () => {
    it('passes with empty gates array', async () => {
      const result = await gated(
        async () => ({ anything: true }),
        { gates: [] },
      )
      expect(result.data).toEqual({ anything: true })
      expect(result.attempts).toBe(1)
    })
  })
})
