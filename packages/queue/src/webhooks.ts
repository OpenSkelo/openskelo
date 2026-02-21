export interface WebhookConfig {
  url: string
  events: string[]
  headers?: Record<string, string>
  method?: 'POST' | 'GET'
  body_template?: 'default' | 'telegram' | 'slack'
  timeout_ms?: number
  chat_id?: string
}

export interface WebhookEvent {
  event: string
  task_id: string
  task_summary: string
  task_type: string
  task_status: string
  pipeline_id?: string
  pipeline_progress?: string
  timestamp: string
  metadata?: Record<string, unknown>
}

function telegramEscape(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

function formatTelegram(event: WebhookEvent): string {
  const safeSummary = telegramEscape(event.task_summary)
  const safeType = telegramEscape(event.task_type)
  const safeStatus = telegramEscape(event.task_status)
  const safeTaskId = telegramEscape(event.task_id)
  const safeReason = telegramEscape(String(event.metadata?.reason ?? 'Task blocked'))
  const safePipelineId = telegramEscape(event.pipeline_id ?? 'unknown')

  switch (event.event) {
    case 'review':
      return [
        '\u{1F514} OpenSkelo: Task needs review',
        '',
        `\u{1F4CB} ${safeSummary}`,
        `\u{1F3F7} Type: ${safeType} | Status: ${safeStatus}`,
        `\u{1F517} Task ID: ${safeTaskId}`,
        '',
        `\u2192 openskelo approve ${safeTaskId}`,
      ].join('\n')

    case 'blocked':
      return [
        '\u{1F6AB} OpenSkelo: Task blocked',
        '',
        `\u{1F4CB} ${safeSummary}`,
        `\u26A0\uFE0F ${safeReason}`,
        `\u{1F517} Task ID: ${safeTaskId}`,
      ].join('\n')

    case 'done':
      return [
        '\u2705 OpenSkelo: Task complete',
        '',
        `\u{1F4CB} ${safeSummary}`,
        `\u{1F3F7} Type: ${safeType}`,
        `\u{1F517} Task ID: ${safeTaskId}`,
      ].join('\n')

    case 'pipeline_held':
      return [
        '\u23F8\uFE0F OpenSkelo: Pipeline held',
        '',
        `\u{1F4CB} ${safeSummary}`,
        `\u26D3 Pipeline ${safePipelineId} paused for fix`,
        `\u{1F527} ${event.metadata?.held_count ?? '?'} downstream task(s) held`,
        `\u{1F517} Task ID: ${safeTaskId}`,
      ].join('\n')

    case 'pipeline_resumed':
      return [
        '\u25B6\uFE0F OpenSkelo: Pipeline resumed',
        '',
        `\u{1F4CB} ${safeSummary}`,
        `\u26D3 Pipeline ${safePipelineId} unblocked`,
        `\u2705 ${event.metadata?.unhold_count ?? '?'} downstream task(s) resumed`,
        `\u{1F517} Task ID: ${safeTaskId}`,
      ].join('\n')

    case 'pipeline_complete':
      return [
        '\u{1F3C1} OpenSkelo: Pipeline complete',
        '',
        `\u{1F4CB} Pipeline ${safePipelineId}`,
        event.pipeline_progress ? `${event.pipeline_progress} tasks done` : '',
      ].filter(Boolean).join('\n')

    default:
      return `OpenSkelo: ${event.event} — ${safeSummary} (${safeTaskId})`
  }
}

function formatSlack(event: WebhookEvent): string {
  switch (event.event) {
    case 'review':
      return `\u{1F514} *OpenSkelo*: Task _${event.task_summary}_ needs review (${event.task_type}/${event.task_status})`
    case 'blocked':
      return `\u{1F6AB} *OpenSkelo*: Task _${event.task_summary}_ blocked`
    case 'done':
      return `\u2705 *OpenSkelo*: Task _${event.task_summary}_ complete (${event.task_type})`
    case 'pipeline_held':
      return `\u23F8\uFE0F *OpenSkelo*: Pipeline ${event.pipeline_id ?? 'unknown'} held — _${event.task_summary}_ paused for fix (${event.metadata?.held_count ?? '?'} tasks)`
    case 'pipeline_resumed':
      return `\u25B6\uFE0F *OpenSkelo*: Pipeline ${event.pipeline_id ?? 'unknown'} resumed — _${event.task_summary}_ (${event.metadata?.unhold_count ?? '?'} tasks unblocked)`
    case 'pipeline_complete':
      return `\u{1F3C1} *OpenSkelo*: Pipeline ${event.pipeline_id ?? 'unknown'} complete (${event.pipeline_progress ?? '?'})`
    default:
      return `*OpenSkelo*: ${event.event} — _${event.task_summary}_ (${event.task_id})`
  }
}

function buildBody(webhook: WebhookConfig, event: WebhookEvent): string {
  const template = webhook.body_template ?? 'default'

  if (template === 'telegram') {
    const body: Record<string, unknown> = {
      text: formatTelegram(event),
      parse_mode: 'HTML',
    }
    if (webhook.chat_id) {
      body.chat_id = webhook.chat_id
    }
    return JSON.stringify(body)
  }

  if (template === 'slack') {
    return JSON.stringify({
      text: formatSlack(event),
    })
  }

  return JSON.stringify(event)
}

function matchesEvent(webhook: WebhookConfig, event: WebhookEvent): boolean {
  return webhook.events.includes('*') || webhook.events.includes(event.event)
}

export class WebhookDispatcher {
  private webhooks: WebhookConfig[]

  constructor(webhooks: WebhookConfig[]) {
    this.webhooks = webhooks
  }

  emit(event: WebhookEvent): void {
    const matching = this.webhooks.filter(w => matchesEvent(w, event))
    if (matching.length === 0) return

    void Promise.allSettled(
      matching.map(webhook => this.send(webhook, event)),
    )
  }

  private async send(webhook: WebhookConfig, event: WebhookEvent): Promise<void> {
    const method = webhook.method ?? 'POST'
    const timeout = webhook.timeout_ms ?? 5000
    const body = buildBody(webhook, event)
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...webhook.headers,
    }

    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeout)

    try {
      const res = await fetch(webhook.url, {
        method,
        headers,
        body: method === 'POST' ? body : undefined,
        signal: controller.signal,
      })
      if (!res.ok) {
        console.error(`Webhook ${webhook.url} returned ${res.status}`)
      }
    } catch {
      // Fire-and-forget — log but don't throw
    } finally {
      clearTimeout(timer)
    }
  }
}
