import { describe, expect, it, vi } from 'vitest'
import { GateExhaustionError } from '../src/errors.js'
import { compileFeedback, runWithRetries } from '../src/retry.js'
import type { GateResult, RetryContext } from '../src/types.js'

function failGate(reason = 'failed', details?: unknown): GateResult {
  return { gate: 'test-gate', passed: false, reason, details, duration_ms: 1 }
}

function passGate(): GateResult {
  return { gate: 'test-gate', passed: true, duration_ms: 1 }
}

describe('retry engine', () => {
  it('passes on first attempt with no retry', async () => {
    const producer = vi.fn(async () => ({ data: 'ok', raw: 'ok' }))
    const evaluate = vi.fn(async () => [passGate()])

    const result = await runWithRetries({
      producer,
      evaluate,
      retry: { max: 3, feedback: true }
    })

    expect(result.attempts).toBe(1)
    expect(producer).toHaveBeenCalledTimes(1)
  })

  it('fails then passes on attempt 2', async () => {
    const evaluate = vi
      .fn()
      .mockResolvedValueOnce([failGate('no')])
      .mockResolvedValueOnce([passGate()])

    const result = await runWithRetries({
      producer: async () => ({ data: 'x', raw: 'x' }),
      evaluate,
      retry: { max: 3, feedback: true }
    })

    expect(result.attempts).toBe(2)
  })

  it('fails then passes on attempt 3', async () => {
    const evaluate = vi
      .fn()
      .mockResolvedValueOnce([failGate('no1')])
      .mockResolvedValueOnce([failGate('no2')])
      .mockResolvedValueOnce([passGate()])

    const result = await runWithRetries({
      producer: async () => ({ data: 'x', raw: 'x' }),
      evaluate,
      retry: { max: 3, feedback: true }
    })

    expect(result.attempts).toBe(3)
  })

  it('throws GateExhaustionError when max exceeded', async () => {
    await expect(runWithRetries({
      producer: async () => ({ data: 'x', raw: 'x' }),
      evaluate: async () => [failGate('still bad')],
      retry: { max: 2, feedback: true }
    })).rejects.toBeInstanceOf(GateExhaustionError)
  })

  it('formats feedback as numbered list', () => {
    const text = compileFeedback([failGate('a'), failGate('b')])
    expect(text).toContain('1. [test-gate] a')
    expect(text).toContain('2. [test-gate] b')
  })

  it('feedback includes reason', () => {
    const text = compileFeedback([failGate('must include tests')])
    expect(text).toContain('must include tests')
  })

  it('feedback includes details payload', () => {
    const text = compileFeedback([failGate('x', { expected: 1 })])
    expect(text).toContain('details')
    expect(text).toContain('expected')
  })

  it('history has proper structure', async () => {
    const result = await runWithRetries({
      producer: async () => ({ data: 'x', raw: 'x' }),
      evaluate: async () => [passGate()],
      retry: { max: 1, feedback: true }
    })

    expect(result.history[0]).toMatchObject({ attempt: 1, passed: true })
  })

  it('applies fixed delay between retries', async () => {
    const started = Date.now()
    const evaluate = vi
      .fn()
      .mockResolvedValueOnce([failGate('a')])
      .mockResolvedValueOnce([passGate()])

    await runWithRetries({
      producer: async () => ({ data: 'x', raw: 'x' }),
      evaluate,
      retry: { max: 2, feedback: true, delay_ms: 25, backoff: 'none' }
    })

    expect(Date.now() - started).toBeGreaterThanOrEqual(20)
  })

  it('applies linear backoff', async () => {
    const started = Date.now()
    const evaluate = vi
      .fn()
      .mockResolvedValueOnce([failGate('a')])
      .mockResolvedValueOnce([failGate('b')])
      .mockResolvedValueOnce([passGate()])

    await runWithRetries({
      producer: async () => ({ data: 'x', raw: 'x' }),
      evaluate,
      retry: { max: 3, feedback: true, delay_ms: 10, backoff: 'linear' }
    })

    expect(Date.now() - started).toBeGreaterThanOrEqual(25)
  })

  it('applies exponential backoff', async () => {
    const started = Date.now()
    const evaluate = vi
      .fn()
      .mockResolvedValueOnce([failGate('a')])
      .mockResolvedValueOnce([failGate('b')])
      .mockResolvedValueOnce([passGate()])

    await runWithRetries({
      producer: async () => ({ data: 'x', raw: 'x' }),
      evaluate,
      retry: { max: 3, feedback: true, delay_ms: 10, backoff: 'exponential' }
    })

    expect(Date.now() - started).toBeGreaterThanOrEqual(25)
  })

  it('passes RetryContext attempt to producer', async () => {
    const attempts: number[] = []
    await runWithRetries({
      producer: async (ctx: RetryContext) => {
        attempts.push(ctx.attempt)
        return { data: 'x', raw: 'x' }
      },
      evaluate: async (_d, _r, ctx) => [ctx.attempt === 2 ? passGate() : failGate('bad')],
      retry: { max: 3, feedback: true }
    })

    expect(attempts).toEqual([1, 2])
  })

  it('passes previous failures in RetryContext', async () => {
    const failuresSeen: number[] = []
    await runWithRetries({
      producer: async (ctx) => {
        failuresSeen.push(ctx.failures.length)
        return { data: 'x', raw: 'x' }
      },
      evaluate: async (_d, _r, ctx) => [ctx.attempt === 2 ? passGate() : failGate('bad')],
      retry: { max: 3, feedback: true }
    })

    expect(failuresSeen).toEqual([0, 1])
  })

  it('does not send feedback when feedback disabled', async () => {
    const feedbackSeen: Array<string | undefined> = []
    await runWithRetries({
      producer: async (ctx) => {
        feedbackSeen.push(ctx.feedback)
        return { data: 'x', raw: 'x' }
      },
      evaluate: async (_d, _r, ctx) => [ctx.attempt === 2 ? passGate() : failGate('bad')],
      retry: { max: 2, feedback: false }
    })

    expect(feedbackSeen).toEqual([undefined, undefined])
  })

  it('invokes onAttempt callback each attempt', async () => {
    const callback = vi.fn()
    await runWithRetries({
      producer: async () => ({ data: 'x', raw: 'x' }),
      evaluate: async () => [passGate()],
      retry: { max: 1, feedback: true },
      onAttempt: callback
    })

    expect(callback).toHaveBeenCalledTimes(1)
  })

  it('returns final gate list from successful attempt', async () => {
    const result = await runWithRetries({
      producer: async () => ({ data: 'x', raw: 'x' }),
      evaluate: async (_d, _r, ctx) => [ctx.attempt === 2 ? passGate() : failGate('bad')],
      retry: { max: 2, feedback: true }
    })

    expect(result.gates[0].passed).toBe(true)
  })

  it('returns attempts count correctly', async () => {
    const result = await runWithRetries({
      producer: async () => ({ data: 'x', raw: 'x' }),
      evaluate: async (_d, _r, ctx) => [ctx.attempt === 3 ? passGate() : failGate('bad')],
      retry: { max: 3, feedback: true }
    })

    expect(result.attempts).toBe(3)
  })

  it('compileFeedback handles empty list', () => {
    expect(compileFeedback([])).toContain('No gate failures')
  })

  it('GateExhaustionError carries full history', async () => {
    try {
      await runWithRetries({
        producer: async () => ({ data: 'x', raw: 'x' }),
        evaluate: async () => [failGate('never')],
        retry: { max: 3, feedback: true }
      })
      throw new Error('should not pass')
    } catch (err) {
      expect(err).toBeInstanceOf(GateExhaustionError)
      expect((err as GateExhaustionError).history.length).toBe(3)
    }
  })

  it('enforces minimum of one attempt when max is zero', async () => {
    await expect(runWithRetries({
      producer: async () => ({ data: 'x', raw: 'x' }),
      evaluate: async () => [failGate('no')],
      retry: { max: 0, feedback: true }
    })).rejects.toBeInstanceOf(GateExhaustionError)
  })
})
