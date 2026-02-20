import type {
  ExecutionAdapter,
  AdapterResult,
  TaskInput,
  CostInfo,
} from '../types.js'
import type { RetryContext } from '@openskelo/gates'
import { buildTaskPrompt } from '../utils/prompt-builder.js'

const DEFAULT_MODEL = 'claude-sonnet-4-5-20250929'
const ANTHROPIC_API_URL = 'https://api.anthropic.com/v1/messages'
const ANTHROPIC_VERSION = '2023-06-01'

export class RawApiAdapter implements ExecutionAdapter {
  readonly name = 'raw-api'
  readonly taskTypes = ['chat', 'completion', 'general']

  private fetchFn: typeof fetch

  constructor(fetchFn?: typeof fetch) {
    this.fetchFn = fetchFn ?? globalThis.fetch
  }

  canHandle(task: TaskInput): boolean {
    return task.backend === this.name || this.taskTypes.includes(task.type)
  }

  async execute(task: TaskInput, _retryCtx?: RetryContext): Promise<AdapterResult> {
    const start = performance.now()
    const config = task.backend_config ?? {}
    const model = config.model ?? DEFAULT_MODEL
    const apiKey = config.env?.ANTHROPIC_API_KEY ?? process.env.ANTHROPIC_API_KEY ?? ''
    const prompt = buildTaskPrompt(task)
    const timeoutMs = config.timeout_ms

    try {
      const body = JSON.stringify({
        model,
        max_tokens: 4096,
        messages: [{ role: 'user', content: prompt }],
      })

      const fetchPromise = this.fetchFn(ANTHROPIC_API_URL, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': ANTHROPIC_VERSION,
        },
        body,
      })

      let response: Response
      if (timeoutMs) {
        response = await Promise.race([
          fetchPromise,
          timeout(timeoutMs),
        ])
      } else {
        response = await fetchPromise
      }

      if (!response.ok) {
        const errBody = await response.json() as { error?: { message?: string } }
        const message = errBody?.error?.message ?? `HTTP ${response.status}`
        return {
          output: message,
          exit_code: 1,
          duration_ms: performance.now() - start,
        }
      }

      const data = await response.json() as {
        content?: { type: string; text: string }[]
        usage?: { input_tokens: number; output_tokens: number }
      }

      const text = data.content
        ?.filter(c => c.type === 'text')
        .map(c => c.text)
        .join('') ?? ''

      let structured: unknown = null
      try {
        structured = JSON.parse(text)
      } catch {
        // not JSON
      }

      const cost: CostInfo | undefined = data.usage
        ? {
            input_tokens: data.usage.input_tokens,
            output_tokens: data.usage.output_tokens,
            total_tokens: data.usage.input_tokens + data.usage.output_tokens,
          }
        : undefined

      return {
        output: text,
        structured,
        exit_code: 0,
        duration_ms: performance.now() - start,
        cost,
      }
    } catch (err) {
      return {
        output: err instanceof Error ? err.message : String(err),
        exit_code: 1,
        duration_ms: performance.now() - start,
      }
    }
  }

  async abort(_taskId: string): Promise<void> {
    // HTTP requests can't be easily cancelled; no-op
  }
}

function timeout(ms: number): Promise<never> {
  return new Promise((_, reject) =>
    setTimeout(() => reject(new Error('Request timed out')), ms)
  )
}
