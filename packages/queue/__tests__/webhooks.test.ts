import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { WebhookDispatcher } from '../src/webhooks.js'
import type { WebhookConfig, WebhookEvent } from '../src/webhooks.js'

function makeEvent(overrides: Partial<WebhookEvent> = {}): WebhookEvent {
  return {
    event: 'review',
    task_id: 'TASK-001',
    task_summary: 'Fix login bug',
    task_type: 'code',
    task_status: 'REVIEW',
    timestamp: '2026-02-21T00:00:00.000Z',
    ...overrides,
  }
}

describe('WebhookDispatcher', () => {
  let fetchMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    fetchMock = vi.fn().mockResolvedValue({ ok: true })
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('sends POST to matching webhook URLs', async () => {
    const webhooks: WebhookConfig[] = [
      { url: 'https://example.com/hook', events: ['review'] },
    ]
    const dispatcher = new WebhookDispatcher(webhooks)
    dispatcher.emit(makeEvent())

    // Wait for fire-and-forget
    await new Promise(r => setTimeout(r, 10))

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock.mock.calls[0][0]).toBe('https://example.com/hook')
    expect(fetchMock.mock.calls[0][1].method).toBe('POST')
  })

  it('event filtering: only fires on matching events', async () => {
    const webhooks: WebhookConfig[] = [
      { url: 'https://example.com/hook', events: ['review'] },
    ]
    const dispatcher = new WebhookDispatcher(webhooks)
    dispatcher.emit(makeEvent({ event: 'done' }))

    await new Promise(r => setTimeout(r, 10))

    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('wildcard: events ["*"] fires on all events', async () => {
    const webhooks: WebhookConfig[] = [
      { url: 'https://example.com/hook', events: ['*'] },
    ]
    const dispatcher = new WebhookDispatcher(webhooks)
    dispatcher.emit(makeEvent({ event: 'done' }))

    await new Promise(r => setTimeout(r, 10))

    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('telegram template formats message correctly', async () => {
    const webhooks: WebhookConfig[] = [
      { url: 'https://api.telegram.org/bot123/sendMessage', events: ['review'], body_template: 'telegram' },
    ]
    const dispatcher = new WebhookDispatcher(webhooks)
    dispatcher.emit(makeEvent())

    await new Promise(r => setTimeout(r, 10))

    const body = JSON.parse(fetchMock.mock.calls[0][1].body)
    expect(body).toHaveProperty('text')
    expect(body.text).toContain('Fix login bug')
    expect(body.text).toContain('needs review')
    expect(body.text).toContain('TASK-001')
  })

  it('telegram template escapes HTML characters in task summary', async () => {
    const webhooks: WebhookConfig[] = [
      { url: 'https://api.telegram.org/bot123/sendMessage', events: ['review'], body_template: 'telegram' },
    ]
    const dispatcher = new WebhookDispatcher(webhooks)
    dispatcher.emit(makeEvent({ task_summary: 'Fix <auth> & login' }))

    await new Promise(r => setTimeout(r, 10))

    const body = JSON.parse(fetchMock.mock.calls[0][1].body)
    expect(body.text).toContain('Fix &lt;auth&gt; &amp; login')
    expect(body.text).not.toContain('Fix <auth> & login')
  })

  it('telegram template escapes script tags in summary', async () => {
    const webhooks: WebhookConfig[] = [
      { url: 'https://api.telegram.org/bot123/sendMessage', events: ['review'], body_template: 'telegram' },
    ]
    const dispatcher = new WebhookDispatcher(webhooks)
    dispatcher.emit(makeEvent({ task_summary: '<script>alert(1)</script>' }))

    await new Promise(r => setTimeout(r, 10))

    const body = JSON.parse(fetchMock.mock.calls[0][1].body)
    expect(body.text).toContain('&lt;script&gt;alert(1)&lt;/script&gt;')
    expect(body.text).not.toContain('<script>alert(1)</script>')
  })

  it('slack template formats message correctly', async () => {
    const webhooks: WebhookConfig[] = [
      { url: 'https://hooks.slack.com/services/xxx', events: ['review'], body_template: 'slack' },
    ]
    const dispatcher = new WebhookDispatcher(webhooks)
    dispatcher.emit(makeEvent())

    await new Promise(r => setTimeout(r, 10))

    const body = JSON.parse(fetchMock.mock.calls[0][1].body)
    expect(body).toHaveProperty('text')
    expect(body.text).toContain('Fix login bug')
    expect(body.text).toContain('needs review')
  })

  it('default template sends full JSON event', async () => {
    const webhooks: WebhookConfig[] = [
      { url: 'https://example.com/hook', events: ['review'] },
    ]
    const dispatcher = new WebhookDispatcher(webhooks)
    const event = makeEvent()
    dispatcher.emit(event)

    await new Promise(r => setTimeout(r, 10))

    const body = JSON.parse(fetchMock.mock.calls[0][1].body)
    expect(body.event).toBe('review')
    expect(body.task_id).toBe('TASK-001')
    expect(body.task_summary).toBe('Fix login bug')
  })

  it('timeout does not block caller', async () => {
    fetchMock.mockImplementation(() => new Promise((_, reject) => {
      setTimeout(() => reject(new Error('timeout')), 200)
    }))

    const webhooks: WebhookConfig[] = [
      { url: 'https://slow.example.com/hook', events: ['review'], timeout_ms: 100 },
    ]
    const dispatcher = new WebhookDispatcher(webhooks)

    const start = Date.now()
    dispatcher.emit(makeEvent())
    const elapsed = Date.now() - start

    // emit() should return immediately (fire-and-forget)
    expect(elapsed).toBeLessThan(50)
  })

  it('failure isolation: one failing webhook does not prevent others', async () => {
    fetchMock
      .mockRejectedValueOnce(new Error('network error'))
      .mockResolvedValueOnce({ ok: true })

    const webhooks: WebhookConfig[] = [
      { url: 'https://broken.example.com/hook', events: ['review'] },
      { url: 'https://working.example.com/hook', events: ['review'] },
    ]
    const dispatcher = new WebhookDispatcher(webhooks)
    dispatcher.emit(makeEvent())

    await new Promise(r => setTimeout(r, 50))

    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('logs error when webhook returns non-2xx response', async () => {
    fetchMock.mockResolvedValueOnce({ ok: false, status: 500 })
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    const webhooks: WebhookConfig[] = [
      { url: 'https://error.example.com/hook', events: ['review'] },
    ]
    const dispatcher = new WebhookDispatcher(webhooks)
    dispatcher.emit(makeEvent())

    await new Promise(r => setTimeout(r, 10))

    expect(errSpy).toHaveBeenCalledWith('Webhook https://error.example.com/hook returned 500')
  })

  it('emit does not throw even when all webhooks fail', () => {
    fetchMock.mockRejectedValue(new Error('fail'))

    const webhooks: WebhookConfig[] = [
      { url: 'https://broken1.example.com/hook', events: ['*'] },
      { url: 'https://broken2.example.com/hook', events: ['*'] },
    ]
    const dispatcher = new WebhookDispatcher(webhooks)

    expect(() => dispatcher.emit(makeEvent())).not.toThrow()
  })

  it('includes custom headers', async () => {
    const webhooks: WebhookConfig[] = [
      {
        url: 'https://example.com/hook',
        events: ['review'],
        headers: { Authorization: 'Bearer secret' },
      },
    ]
    const dispatcher = new WebhookDispatcher(webhooks)
    dispatcher.emit(makeEvent())

    await new Promise(r => setTimeout(r, 10))

    const headers = fetchMock.mock.calls[0][1].headers
    expect(headers.Authorization).toBe('Bearer secret')
  })

  it('telegram template for blocked event', async () => {
    const webhooks: WebhookConfig[] = [
      { url: 'https://t.me/bot', events: ['blocked'], body_template: 'telegram' },
    ]
    const dispatcher = new WebhookDispatcher(webhooks)
    dispatcher.emit(makeEvent({ event: 'blocked', task_status: 'BLOCKED' }))

    await new Promise(r => setTimeout(r, 10))

    const body = JSON.parse(fetchMock.mock.calls[0][1].body)
    expect(body.text).toContain('blocked')
    expect(body.text).toContain('Fix login bug')
  })

  it('telegram body includes chat_id when configured', async () => {
    const webhooks: WebhookConfig[] = [
      { url: 'https://api.telegram.org/bot123/sendMessage', events: ['review'], body_template: 'telegram', chat_id: '12345' },
    ]
    const dispatcher = new WebhookDispatcher(webhooks)
    dispatcher.emit(makeEvent())

    await new Promise(r => setTimeout(r, 10))

    const body = JSON.parse(fetchMock.mock.calls[0][1].body)
    expect(body.chat_id).toBe('12345')
    expect(body.parse_mode).toBe('HTML')
    expect(body.text).toContain('Fix login bug')
  })

  it('telegram body omits chat_id when not configured', async () => {
    const webhooks: WebhookConfig[] = [
      { url: 'https://api.telegram.org/bot123/sendMessage', events: ['review'], body_template: 'telegram' },
    ]
    const dispatcher = new WebhookDispatcher(webhooks)
    dispatcher.emit(makeEvent())

    await new Promise(r => setTimeout(r, 10))

    const body = JSON.parse(fetchMock.mock.calls[0][1].body)
    expect(body.chat_id).toBeUndefined()
    expect(body.parse_mode).toBe('HTML')
  })

  it('telegram template for pipeline_complete event', async () => {
    const webhooks: WebhookConfig[] = [
      { url: 'https://t.me/bot', events: ['pipeline_complete'], body_template: 'telegram' },
    ]
    const dispatcher = new WebhookDispatcher(webhooks)
    dispatcher.emit(makeEvent({
      event: 'pipeline_complete',
      pipeline_id: 'PIPE-001',
      pipeline_progress: '5/5',
    }))

    await new Promise(r => setTimeout(r, 10))

    const body = JSON.parse(fetchMock.mock.calls[0][1].body)
    expect(body.text).toContain('Pipeline complete')
    expect(body.text).toContain('PIPE-001')
    expect(body.text).toContain('5/5')
  })
})
