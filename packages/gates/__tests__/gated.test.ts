import { describe, expect, it, vi } from 'vitest'
import { GateExhaustionError, gated } from '../src/index.js'

describe('gated() public API', () => {
  it('passes on first attempt (happy path)', async () => {
    const result = await gated(async () => 'hello world', {
      extract: 'text',
      gates: [{ type: 'word_count', min: 2 }]
    })

    expect(result.attempts).toBe(1)
    expect(result.data).toBe('hello world')
    expect(result.gates.every((g) => g.passed)).toBe(true)
  })

  it('retries then passes on second attempt', async () => {
    const result = await gated(async (ctx) => (ctx.attempt === 1 ? 'bad' : 'good output'), {
      extract: 'text',
      retry: { max: 2, feedback: true },
      gates: [{ type: 'word_count', min: 2 }]
    })

    expect(result.attempts).toBe(2)
    expect(result.history.length).toBe(2)
    expect(result.gates[0].passed).toBe(true)
  })

  it('throws GateExhaustionError when all attempts fail', async () => {
    await expect(gated(async () => 'bad', {
      extract: 'text',
      retry: { max: 2, feedback: true },
      gates: [{ type: 'word_count', min: 2 }]
    })).rejects.toBeInstanceOf(GateExhaustionError)
  })

  it('supports json extract mode', async () => {
    const result = await gated(async () => '{"name":"Nora"}', {
      extract: 'json',
      gates: [{ type: 'json_schema', schema: { type: 'object', required: ['name'] } }]
    })

    expect(result.data).toEqual({ name: 'Nora' })
  })

  it('supports text extract mode', async () => {
    const result = await gated(async () => 'plain text', {
      extract: 'text',
      gates: [{ type: 'regex', pattern: 'plain' }]
    })

    expect(result.data).toBe('plain text')
  })

  it('supports auto extract mode with JSON', async () => {
    const result = await gated(async () => '{"ok":true}', {
      extract: 'auto',
      gates: [{ type: 'json_schema', schema: { type: 'object', required: ['ok'] } }]
    })

    expect(result.data).toEqual({ ok: true })
  })

  it('supports auto extract fallback to text', async () => {
    const result = await gated(async () => 'not json output', {
      extract: 'auto',
      gates: [{ type: 'regex', pattern: 'output' }]
    })

    expect(result.data).toBe('not json output')
  })

  it('supports custom extract function', async () => {
    const result = await gated(async () => '42', {
      extract: (raw) => Number(raw),
      gates: [{ type: 'expression', expr: 'data === 42' }]
    })

    expect(result.data).toBe(42)
  })

  it('fires onAttempt callback after each attempt', async () => {
    const onAttempt = vi.fn()

    await gated(async (ctx) => (ctx.attempt === 1 ? 'bad' : 'good output'), {
      extract: 'text',
      retry: { max: 2, feedback: true },
      onAttempt,
      gates: [{ type: 'word_count', min: 2 }]
    })

    expect(onAttempt).toHaveBeenCalledTimes(2)
  })

  it('supports timeout per attempt', async () => {
    await expect(gated(async () => {
      await new Promise((resolve) => setTimeout(resolve, 40))
      return 'slow'
    }, {
      extract: 'text',
      timeout: 10,
      retry: { max: 1, feedback: true },
      gates: [{ type: 'word_count', min: 1 }]
    })).rejects.toThrow('timed out')
  })

  it('returns final attempt gates and full history', async () => {
    const result = await gated(async (ctx) => (ctx.attempt === 1 ? 'bad' : 'good output'), {
      extract: 'text',
      retry: { max: 2, feedback: true },
      gates: [{ type: 'word_count', min: 2 }]
    })

    expect(result.gates.length).toBe(1)
    expect(result.history.length).toBe(2)
    expect(result.history[0].passed).toBe(false)
    expect(result.history[1].passed).toBe(true)
  })

  it('records total duration', async () => {
    const result = await gated(async () => 'hello world', {
      extract: 'text',
      gates: [{ type: 'word_count', min: 2 }]
    })

    expect(result.duration_ms).toBeGreaterThanOrEqual(0)
  })

  it('passes retry context feedback into producer', async () => {
    const feedbacks: Array<string | undefined> = []

    await gated(async (ctx) => {
      feedbacks.push(ctx.feedback)
      return ctx.attempt === 1 ? 'bad' : 'good output'
    }, {
      extract: 'text',
      retry: { max: 2, feedback: true },
      gates: [{ type: 'word_count', min: 2 }]
    })

    expect(feedbacks[0]).toBeUndefined()
    expect(feedbacks[1]).toContain('word_count')
  })

  it('accepts producer output object with raw field', async () => {
    const result = await gated(async () => ({ raw: 'raw payload text' }), {
      extract: 'text',
      gates: [{ type: 'regex', pattern: 'payload' }]
    })

    expect(result.raw).toBe('raw payload text')
    expect(result.data).toBe('raw payload text')
  })

  it('supports multiple gates in sequence', async () => {
    const result = await gated(async () => 'hello world', {
      extract: 'text',
      gates: [
        { type: 'regex', pattern: 'hello' },
        { type: 'word_count', min: 2 }
      ]
    })

    expect(result.gates.length).toBe(2)
    expect(result.gates.every((g) => g.passed)).toBe(true)
  })
})
