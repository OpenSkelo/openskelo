import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { OpenRouterAdapter } from '../src/adapters/openrouter.js'
import type { TaskInput } from '../src/types.js'

function makeTask(overrides: Partial<TaskInput> = {}): TaskInput {
  return {
    id: 'or-1',
    type: 'chat',
    summary: 'Summarize this document',
    prompt: 'Please summarize the following text...',
    backend: 'openrouter',
    backend_config: {
      env: { OPENROUTER_API_KEY: 'sk-or-test-key' },
    },
    ...overrides,
  }
}

const mockSuccessResponse = {
  choices: [
    { message: { content: 'Here is the summary.' } },
  ],
  usage: {
    prompt_tokens: 100,
    completion_tokens: 50,
    total_tokens: 150,
  },
}

describe('OpenRouterAdapter', () => {
  let adapter: OpenRouterAdapter
  let mockFetch: ReturnType<typeof vi.fn>

  beforeEach(() => {
    mockFetch = vi.fn()
    adapter = new OpenRouterAdapter(undefined, undefined, mockFetch as typeof fetch)
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('sends request to OpenRouter API URL', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(mockSuccessResponse),
    })

    await adapter.execute(makeTask())

    const [url] = mockFetch.mock.calls[0]
    expect(url).toBe('https://openrouter.ai/api/v1/chat/completions')
  })

  it('includes Authorization Bearer header', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(mockSuccessResponse),
    })

    await adapter.execute(makeTask())

    const headers = mockFetch.mock.calls[0][1].headers
    expect(headers.Authorization).toBe('Bearer sk-or-test-key')
    expect(headers['content-type']).toBe('application/json')
  })

  it('sends correct request body with model and messages', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(mockSuccessResponse),
    })

    await adapter.execute(makeTask())

    const body = JSON.parse(mockFetch.mock.calls[0][1].body)
    expect(body.model).toBe('anthropic/claude-sonnet-4-5-20250929')
    expect(body.messages).toHaveLength(1)
    expect(body.messages[0].role).toBe('user')
    expect(body.messages[0].content).toContain('Summarize this document')
  })

  it('uses model from backend_config', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(mockSuccessResponse),
    })

    await adapter.execute(makeTask({
      backend_config: {
        model: 'anthropic/claude-opus-4-5-20250514',
        env: { OPENROUTER_API_KEY: 'key' },
      },
    }))

    const body = JSON.parse(mockFetch.mock.calls[0][1].body)
    expect(body.model).toBe('anthropic/claude-opus-4-5-20250514')
  })

  it('falls back to default model', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(mockSuccessResponse),
    })

    await adapter.execute(makeTask({ backend_config: { env: { OPENROUTER_API_KEY: 'key' } } }))

    const body = JSON.parse(mockFetch.mock.calls[0][1].body)
    expect(body.model).toBe('anthropic/claude-sonnet-4-5-20250929')
  })

  it('parses successful response', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(mockSuccessResponse),
    })

    const result = await adapter.execute(makeTask())
    expect(result.output).toBe('Here is the summary.')
    expect(result.exit_code).toBe(0)
    expect(result.duration_ms).toBeGreaterThanOrEqual(0)
  })

  it('returns cost from usage data', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(mockSuccessResponse),
    })

    const result = await adapter.execute(makeTask())
    expect(result.cost).toBeDefined()
    expect(result.cost!.input_tokens).toBe(100)
    expect(result.cost!.output_tokens).toBe(50)
    expect(result.cost!.total_tokens).toBe(150)
  })

  it('handles empty choices array', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ choices: [] }),
    })

    const result = await adapter.execute(makeTask())
    expect(result.output).toBe('')
    expect(result.exit_code).toBe(0)
    expect(result.cost).toBeUndefined()
  })

  it('handles missing usage data', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
        choices: [{ message: { content: 'hello' } }],
      }),
    })

    const result = await adapter.execute(makeTask())
    expect(result.output).toBe('hello')
    expect(result.cost).toBeUndefined()
  })

  it('parses JSON structured output', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
        choices: [{ message: { content: '{"approved":true}' } }],
      }),
    })

    const result = await adapter.execute(makeTask())
    expect(result.structured).toEqual({ approved: true })
  })

  it('handles API error response', async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 400,
      text: () => Promise.resolve('{"error":{"message":"Bad request"}}'),
    })

    const result = await adapter.execute(makeTask())
    expect(result.exit_code).toBe(1)
    expect(result.output).toContain('Bad request')
  })

  it('handles network error', async () => {
    mockFetch.mockRejectedValue(new Error('Network error'))

    const result = await adapter.execute(makeTask())
    expect(result.exit_code).toBe(1)
    expect(result.output).toContain('Network error')
  })

  it('retries on 429 rate limit', async () => {
    vi.spyOn(adapter as never, 'delay').mockResolvedValue(undefined)

    mockFetch
      .mockResolvedValueOnce({
        ok: false,
        status: 429,
        headers: { get: () => '1' },
      })
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockSuccessResponse),
      })

    const result = await adapter.execute(makeTask())
    expect(mockFetch).toHaveBeenCalledTimes(2)
    expect(result.output).toBe('Here is the summary.')
  })

  it('canHandle matches openrouter backend', () => {
    expect(adapter.canHandle(makeTask())).toBe(true)
  })

  it('canHandle matches slash-style backend', () => {
    expect(adapter.canHandle(makeTask({ backend: 'openrouter/anthropic/claude-opus-4-5' }))).toBe(true)
  })

  it('canHandle matches by task type', () => {
    expect(adapter.canHandle(makeTask({ backend: 'other', type: 'chat' }))).toBe(true)
  })

  it('default task types include chat, completion, general', () => {
    expect(adapter.taskTypes).toEqual(['chat', 'completion', 'general'])
  })

  it('accepts custom task types', () => {
    const custom = new OpenRouterAdapter(['code', 'review'], undefined, mockFetch as typeof fetch)
    expect(custom.taskTypes).toEqual(['code', 'review'])
  })

  it('uses API key from default config env', async () => {
    const adapterWithConfig = new OpenRouterAdapter(
      undefined,
      { env: { OPENROUTER_API_KEY: 'default-key' } },
      mockFetch as typeof fetch,
    )

    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(mockSuccessResponse),
    })

    await adapterWithConfig.execute(makeTask({ backend_config: undefined }))

    const headers = mockFetch.mock.calls[0][1].headers
    expect(headers.Authorization).toBe('Bearer default-key')
  })

  it('task env overrides default env', async () => {
    const adapterWithConfig = new OpenRouterAdapter(
      undefined,
      { env: { OPENROUTER_API_KEY: 'default-key' } },
      mockFetch as typeof fetch,
    )

    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(mockSuccessResponse),
    })

    await adapterWithConfig.execute(makeTask({
      backend_config: { env: { OPENROUTER_API_KEY: 'task-key' } },
    }))

    const headers = mockFetch.mock.calls[0][1].headers
    expect(headers.Authorization).toBe('Bearer task-key')
  })
})
