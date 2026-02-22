import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { BaseApiAdapter } from '../src/base-api-adapter.js'
import type { AdapterConfig, AdapterResult, TaskInput } from '../src/types.js'

class TestApiAdapter extends BaseApiAdapter {
  constructor(fetchFn?: typeof fetch) {
    super('test-api', ['test'], {}, fetchFn)
  }

  buildRequestUrl(): string {
    return 'https://test.api/v1/chat'
  }

  buildRequestHeaders(): Record<string, string> {
    return { Authorization: 'Bearer test-key' }
  }

  buildRequestBody(task: TaskInput): unknown {
    return { prompt: task.prompt }
  }

  parseResponse(data: unknown): AdapterResult {
    const d = data as { text: string }
    return { output: d.text, exit_code: 0, duration_ms: 0 }
  }
}

function makeTask(overrides: Partial<TaskInput> = {}): TaskInput {
  return {
    id: 'test-1',
    type: 'test',
    summary: 'Test task',
    prompt: 'Do the test thing',
    backend: 'test-api',
    ...overrides,
  }
}

describe('BaseApiAdapter', () => {
  let mockFetch: ReturnType<typeof vi.fn>
  let adapter: TestApiAdapter

  beforeEach(() => {
    mockFetch = vi.fn()
    adapter = new TestApiAdapter(mockFetch as typeof fetch)
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('canHandle matches by adapter name', () => {
    expect(adapter.canHandle(makeTask())).toBe(true)
  })

  it('canHandle matches by task type', () => {
    expect(adapter.canHandle(makeTask({ backend: 'other', type: 'test' }))).toBe(true)
  })

  it('canHandle rejects non-matching task', () => {
    expect(adapter.canHandle(makeTask({ backend: 'other', type: 'unknown' }))).toBe(false)
  })

  it('canHandle matches slash-style backend prefix', () => {
    expect(adapter.canHandle(makeTask({ backend: 'test-api/some-model' }))).toBe(true)
  })

  it('execute calls fetch with correct URL and body', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ text: 'hello' }),
    })

    await adapter.execute(makeTask())

    expect(mockFetch).toHaveBeenCalledOnce()
    const [url, options] = mockFetch.mock.calls[0]
    expect(url).toBe('https://test.api/v1/chat')
    expect(options.method).toBe('POST')
    expect(JSON.parse(options.body)).toEqual({ prompt: 'Do the test thing' })
    expect(options.headers.Authorization).toBe('Bearer test-key')
    expect(options.headers['content-type']).toBe('application/json')
  })

  it('execute returns parsed response on success', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ text: 'result' }),
    })

    const result = await adapter.execute(makeTask())
    expect(result.output).toBe('result')
    expect(result.exit_code).toBe(0)
    expect(result.duration_ms).toBeGreaterThanOrEqual(0)
  })

  it('execute returns error on non-ok response', async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 500,
      text: () => Promise.resolve('Internal Server Error'),
    })

    const result = await adapter.execute(makeTask())
    expect(result.exit_code).toBe(1)
    expect(result.output).toContain('Internal Server Error')
  })

  it('execute returns error on network failure', async () => {
    mockFetch.mockRejectedValue(new Error('Connection refused'))

    const result = await adapter.execute(makeTask())
    expect(result.exit_code).toBe(1)
    expect(result.output).toContain('Connection refused')
  })

  it('execute retries on 429 then succeeds', async () => {
    vi.spyOn(adapter as never, 'delay').mockResolvedValue(undefined)

    mockFetch
      .mockResolvedValueOnce({
        ok: false,
        status: 429,
        headers: { get: () => '1' },
      })
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ text: 'success after retry' }),
      })

    const result = await adapter.execute(makeTask())
    expect(mockFetch).toHaveBeenCalledTimes(2)
    expect(result.output).toBe('success after retry')
    expect(result.exit_code).toBe(0)
  })

  it('execute falls back to exponential delay when retry-after is invalid', async () => {
    const delaySpy = vi.spyOn(adapter as never, 'delay').mockResolvedValue(undefined)

    mockFetch
      .mockResolvedValueOnce({
        ok: false,
        status: 429,
        headers: { get: () => 'not-a-number' },
      })
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ text: 'ok' }),
      })

    const result = await adapter.execute(makeTask())

    expect(result.exit_code).toBe(0)
    expect(delaySpy).toHaveBeenCalledWith(1000)
  })

  it('execute returns 429 error after max retries', async () => {
    vi.spyOn(adapter as never, 'delay').mockResolvedValue(undefined)

    mockFetch.mockResolvedValue({
      ok: false,
      status: 429,
      headers: { get: () => null },
      text: () => Promise.resolve('Rate limited'),
    })

    const result = await adapter.execute(makeTask())
    // 1 initial + 3 retries = 4 calls, then returns the 429
    expect(mockFetch).toHaveBeenCalledTimes(4)
    expect(result.exit_code).toBe(1)
    expect(result.output).toContain('Rate limited')
  })

  it('abort cancels in-flight request', async () => {
    let abortSignal: AbortSignal | undefined
    mockFetch.mockImplementation((_url: string, options: RequestInit) => {
      abortSignal = options.signal as AbortSignal
      return new Promise((_, reject) => {
        options.signal?.addEventListener('abort', () => {
          reject(new DOMException('The operation was aborted.', 'AbortError'))
        })
      })
    })

    const executePromise = adapter.execute(makeTask({ id: 'abort-test' }))

    // Give execute time to start
    await new Promise(r => setTimeout(r, 10))

    await adapter.abort('abort-test')
    expect(abortSignal?.aborted).toBe(true)

    const result = await executePromise
    expect(result.exit_code).toBe(1)
  })

  it('execute tracks duration', async () => {
    mockFetch.mockImplementation(() =>
      new Promise(resolve =>
        setTimeout(() => resolve({
          ok: true,
          json: () => Promise.resolve({ text: 'ok' }),
        }), 50)
      )
    )

    const result = await adapter.execute(makeTask())
    expect(result.duration_ms).toBeGreaterThan(30)
  })

  it('sets failure_code from HTTP status on non-ok response', async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 500,
      text: () => Promise.resolve('Internal Server Error'),
    })

    const result = await adapter.execute(makeTask())
    expect(result.exit_code).toBe(1)
    expect(result.failure_code).toBe('unknown')
  })

  it('sets failure_code=permission_required for 403', async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 403,
      text: () => Promise.resolve('Forbidden'),
    })

    const result = await adapter.execute(makeTask())
    expect(result.failure_code).toBe('permission_required')
  })

  it('sets failure_code from output on network error', async () => {
    mockFetch.mockRejectedValue(new Error('ECONNREFUSED'))

    const result = await adapter.execute(makeTask())
    expect(result.exit_code).toBe(1)
    expect(result.failure_code).toBe('network_error')
  })

  it('does not set failure_code on success', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ text: 'ok' }),
    })

    const result = await adapter.execute(makeTask())
    expect(result.exit_code).toBe(0)
    expect(result.failure_code).toBeUndefined()
  })

  it('merges task backend_config with defaults', async () => {
    const adapterWithDefaults = new (class extends BaseApiAdapter {
      constructor(fetchFn: typeof fetch) {
        super('test', ['test'], { model: 'default-model', env: { KEY: 'default' } }, fetchFn)
      }
      buildRequestUrl() { return 'https://test.api/v1' }
      buildRequestHeaders() { return {} }
      buildRequestBody(_task: TaskInput, config: AdapterConfig) { return { model: config.model, env: config.env } }
      parseResponse(data: unknown) { return { output: JSON.stringify(data), exit_code: 0, duration_ms: 0 } }
    })(mockFetch as typeof fetch)

    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({}),
    })

    await adapterWithDefaults.execute(makeTask({
      backend_config: { env: { KEY: 'override' } },
    }))

    const body = JSON.parse(mockFetch.mock.calls[0][1].body)
    expect(body.model).toBe('default-model')
    expect(body.env.KEY).toBe('override')
  })
})
