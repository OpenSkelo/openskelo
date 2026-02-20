import { describe, it, expect } from 'vitest'
import { retry, compileFeedback } from '../src/retry.js'
import { GateExhaustionError } from '../src/types.js'
import type { RetryContext, GateResult } from '../src/types.js'

describe('retry engine', () => {
  // ── Pass on first try ──

  describe('pass first try', () => {
    it('returns result without retry when gates pass', async () => {
      const result = await retry(
        async () => ({ price: 42 }),
        [{ type: 'expression', expr: 'price > 0' }],
      )
      expect(result.data).toEqual({ price: 42 })
      expect(result.attempts).toBe(1)
      expect(result.gates.every((g) => g.passed)).toBe(true)
    })

    it('history has one entry on first-try pass', async () => {
      const result = await retry(
        async () => ({ x: 1 }),
        [{ type: 'expression', expr: 'x === 1' }],
      )
      expect(result.history).toHaveLength(1)
      expect(result.history[0].passed).toBe(true)
    })

    it('tracks total duration_ms', async () => {
      const result = await retry(
        async () => ({ x: 1 }),
        [{ type: 'expression', expr: 'x === 1' }],
      )
      expect(typeof result.duration_ms).toBe('number')
      expect(result.duration_ms).toBeGreaterThanOrEqual(0)
    })
  })

  // ── Pass on retry ──

  describe('pass on retry', () => {
    it('passes on second attempt after first failure', async () => {
      let attempt = 0
      const result = await retry(
        async () => {
          attempt++
          return attempt >= 2 ? { x: 10 } : { x: 0 }
        },
        [{ type: 'expression', expr: 'x > 5' }],
        { max: 3, feedback: true },
      )
      expect(result.attempts).toBe(2)
      expect(result.data).toEqual({ x: 10 })
    })

    it('passes on third attempt', async () => {
      let attempt = 0
      const result = await retry(
        async () => {
          attempt++
          return { count: attempt }
        },
        [{ type: 'expression', expr: 'count >= 3' }],
        { max: 5, feedback: true },
      )
      expect(result.attempts).toBe(3)
    })

    it('history contains all attempts', async () => {
      let attempt = 0
      const result = await retry(
        async () => {
          attempt++
          return { ok: attempt >= 2 }
        },
        [{ type: 'expression', expr: 'ok' }],
        { max: 3, feedback: true },
      )
      expect(result.history).toHaveLength(2)
      expect(result.history[0].passed).toBe(false)
      expect(result.history[1].passed).toBe(true)
    })
  })

  // ── Feedback ──

  describe('feedback', () => {
    it('provides RetryContext to producer on retry', async () => {
      let capturedContext: RetryContext | undefined
      let attempt = 0

      await retry(
        async (ctx) => {
          attempt++
          if (attempt > 1) capturedContext = ctx
          return { val: attempt >= 2 ? 10 : 0 }
        },
        [{ type: 'expression', expr: 'val > 5' }],
        { max: 3, feedback: true },
      )

      expect(capturedContext).toBeDefined()
      expect(capturedContext!.attempt).toBe(2)
      expect(capturedContext!.feedback).toContain('val > 5')
      expect(capturedContext!.failures).toHaveLength(1)
    })

    it('does not provide context on first attempt', async () => {
      let firstContext: RetryContext | undefined = undefined
      await retry(
        async (ctx) => {
          if (!firstContext) firstContext = ctx
          return { x: 1 }
        },
        [{ type: 'expression', expr: 'x === 1' }],
      )
      expect(firstContext).toBeUndefined()
    })

    it('disables feedback when feedback: false', async () => {
      let capturedContext: RetryContext | undefined
      let attempt = 0

      await retry(
        async (ctx) => {
          attempt++
          if (attempt > 1) capturedContext = ctx
          return { val: attempt >= 2 ? 10 : 0 }
        },
        [{ type: 'expression', expr: 'val > 5' }],
        { max: 3, feedback: false },
      )

      // Still gets context but feedback should be empty
      expect(capturedContext).toBeDefined()
      expect(capturedContext!.feedback).toBe('')
    })
  })

  // ── Exhaustion ──

  describe('exhaustion', () => {
    it('throws GateExhaustionError when all retries fail', async () => {
      await expect(
        retry(
          async () => ({ x: 0 }),
          [{ type: 'expression', expr: 'x > 10' }],
          { max: 3, feedback: true },
        ),
      ).rejects.toThrow(GateExhaustionError)
    })

    it('GateExhaustionError has history', async () => {
      try {
        await retry(
          async () => ({ x: 0 }),
          [{ type: 'expression', expr: 'x > 10' }],
          { max: 2, feedback: true },
        )
        expect.fail('Should have thrown')
      } catch (err) {
        expect(err).toBeInstanceOf(GateExhaustionError)
        const exhaustion = err as GateExhaustionError
        expect(exhaustion.history).toHaveLength(2)
        expect(exhaustion.lastFailures.length).toBeGreaterThan(0)
      }
    })

    it('GateExhaustionError message contains attempt count', async () => {
      try {
        await retry(
          async () => ({ x: 0 }),
          [{ type: 'expression', expr: 'x > 10' }],
          { max: 3, feedback: true },
        )
      } catch (err) {
        expect((err as Error).message).toContain('3')
      }
    })
  })

  // ── Default config ──

  describe('default config', () => {
    it('uses max: 3, feedback: true by default', async () => {
      let attempts = 0
      try {
        await retry(
          async () => {
            attempts++
            return { x: 0 }
          },
          [{ type: 'expression', expr: 'x > 10' }],
        )
      } catch {
        // expected
      }
      expect(attempts).toBe(3)
    })
  })

  // ── Delay ──

  describe('delay', () => {
    it('respects delay_ms between retries', async () => {
      const start = performance.now()
      let attempt = 0

      await retry(
        async () => {
          attempt++
          return { x: attempt >= 2 ? 10 : 0 }
        },
        [{ type: 'expression', expr: 'x > 5' }],
        { max: 3, feedback: true, delay_ms: 50 },
      )

      const elapsed = performance.now() - start
      // Should have at least 1 delay of ~50ms
      expect(elapsed).toBeGreaterThanOrEqual(40)
    })

    it('applies exponential backoff when enabled', async () => {
      const start = performance.now()
      let attempt = 0

      await retry(
        async () => {
          attempt++
          return { x: attempt >= 3 ? 10 : 0 }
        },
        [{ type: 'expression', expr: 'x > 5' }],
        { max: 5, feedback: true, delay_ms: 30, backoff: true },
      )

      const elapsed = performance.now() - start
      // Delays: 30ms, 60ms = 90ms total minimum
      expect(elapsed).toBeGreaterThanOrEqual(70)
    })
  })

  // ── Multiple gates ──

  describe('multiple gates', () => {
    it('all gates must pass for success', async () => {
      let attempt = 0
      const result = await retry(
        async () => {
          attempt++
          return { x: attempt * 10, name: 'test' }
        },
        [
          { type: 'json_schema', schema: { required: ['x', 'name'] } },
          { type: 'expression', expr: 'x >= 20' },
        ],
        { max: 5, feedback: true },
      )
      expect(result.attempts).toBe(2)
      expect(result.gates).toHaveLength(2)
      expect(result.gates.every((g) => g.passed)).toBe(true)
    })
  })

  // ── Raw output ──

  describe('raw output', () => {
    it('preserves raw from producer', async () => {
      const result = await retry(
        async () => ({ parsed: true }),
        [{ type: 'expression', expr: 'parsed' }],
      )
      expect(result.raw).toEqual({ parsed: true })
    })
  })
})
