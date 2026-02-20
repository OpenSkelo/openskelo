import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { RawApiAdapter } from '../src/adapters/raw-api.js'
import type { TaskInput } from '../src/types.js'

function makeTask(overrides: Partial<TaskInput> = {}): TaskInput {
  return {
    id: 'api-1',
    type: 'chat',
    summary: 'Summarize this document',
    prompt: 'Please summarize the following text...',
    backend: 'raw-api',
    backend_config: {
      env: { ANTHROPIC_API_KEY: 'test-key-123' },
    },
    ...overrides,
  }
}

const mockSuccessResponse = {
  id: 'msg_123',
  content: [{ type: 'text', text: 'Here is the summary.' }],
  usage: { input_tokens: 100, output_tokens: 50 },
}

describe('RawApiAdapter', () => {
  let adapter: RawApiAdapter
  let mockFetch: ReturnType<typeof vi.fn>

  beforeEach(() => {
    mockFetch = vi.fn()
    adapter = new RawApiAdapter(mockFetch as typeof fetch)
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('constructs correct request body for Anthropic', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(mockSuccessResponse),
    })

    await adapter.execute(makeTask())

    expect(mockFetch).toHaveBeenCalledOnce()
    const [url, options] = mockFetch.mock.calls[0]
    expect(url).toBe('https://api.anthropic.com/v1/messages')
    const body = JSON.parse(options.body)
    expect(body.messages).toEqual([
      { role: 'user', content: expect.stringContaining('Summarize this document') },
    ])
    expect(body.model).toBe('claude-sonnet-4-5-20250929')
    expect(body.max_tokens).toBe(4096)
  })

  it('includes correct headers', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(mockSuccessResponse),
    })

    await adapter.execute(makeTask())

    const [, options] = mockFetch.mock.calls[0]
    expect(options.headers['x-api-key']).toBe('test-key-123')
    expect(options.headers['anthropic-version']).toBe('2023-06-01')
    expect(options.headers['content-type']).toBe('application/json')
  })

  it('parses successful response', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(mockSuccessResponse),
    })

    const result = await adapter.execute(makeTask())
    expect(result.output).toBe('Here is the summary.')
    expect(result.exit_code).toBe(0)
  })

  it('handles API error response gracefully', async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 400,
      json: () => Promise.resolve({ error: { message: 'Bad request' } }),
    })

    const result = await adapter.execute(makeTask())
    expect(result.exit_code).toBe(1)
    expect(result.output).toContain('Bad request')
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

  it('returns exit_code 1 on network error', async () => {
    mockFetch.mockRejectedValue(new Error('Network error'))

    const result = await adapter.execute(makeTask())
    expect(result.exit_code).toBe(1)
    expect(result.output).toContain('Network error')
  })

  it('uses model from backend_config', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(mockSuccessResponse),
    })

    await adapter.execute(makeTask({ backend_config: { model: 'claude-opus-4-5-20250514', env: { ANTHROPIC_API_KEY: 'key' } } }))

    const body = JSON.parse(mockFetch.mock.calls[0][1].body)
    expect(body.model).toBe('claude-opus-4-5-20250514')
  })

  it('falls back to default model', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(mockSuccessResponse),
    })

    await adapter.execute(makeTask())

    const body = JSON.parse(mockFetch.mock.calls[0][1].body)
    expect(body.model).toBe('claude-sonnet-4-5-20250929')
  })

  it('tracks duration', async () => {
    mockFetch.mockImplementation(() =>
      new Promise(resolve =>
        setTimeout(() => resolve({
          ok: true,
          json: () => Promise.resolve(mockSuccessResponse),
        }), 50)
      )
    )

    const result = await adapter.execute(makeTask())
    expect(result.duration_ms).toBeGreaterThan(30)
  })

  it('handles timeout', async () => {
    mockFetch.mockImplementation(() =>
      new Promise(resolve => setTimeout(resolve, 5000))
    )

    const result = await adapter.execute(
      makeTask({ backend_config: { timeout_ms: 100, env: { ANTHROPIC_API_KEY: 'key' } } })
    )
    expect(result.exit_code).toBe(1)
  }, 5000)
})
