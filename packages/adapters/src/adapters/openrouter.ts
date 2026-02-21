import type { AdapterConfig, AdapterResult, CostInfo, TaskInput } from '../types.js'
import { BaseApiAdapter } from '../base-api-adapter.js'
import { buildTaskPrompt } from '../utils/prompt-builder.js'

const OPENROUTER_API_URL = 'https://openrouter.ai/api/v1/chat/completions'
const DEFAULT_MODEL = 'anthropic/claude-sonnet-4-5-20250929'

export class OpenRouterAdapter extends BaseApiAdapter {
  constructor(
    taskTypes?: string[],
    defaultConfig?: AdapterConfig,
    fetchFn?: typeof fetch,
  ) {
    super(
      'openrouter',
      taskTypes ?? ['chat', 'completion', 'general'],
      defaultConfig,
      fetchFn,
    )
  }

  buildRequestUrl(): string {
    return OPENROUTER_API_URL
  }

  buildRequestHeaders(_task: TaskInput, config: AdapterConfig): Record<string, string> {
    const apiKey = config.env?.OPENROUTER_API_KEY
      ?? process.env.OPENROUTER_API_KEY
      ?? ''
    return {
      Authorization: `Bearer ${apiKey}`,
    }
  }

  buildRequestBody(task: TaskInput, config: AdapterConfig): unknown {
    const model = config.model ?? DEFAULT_MODEL
    const prompt = buildTaskPrompt(task)
    return {
      model,
      messages: [{ role: 'user', content: prompt }],
    }
  }

  parseResponse(data: unknown, _task: TaskInput): AdapterResult {
    const d = data as {
      choices?: { message?: { content?: string } }[]
      usage?: {
        prompt_tokens?: number
        completion_tokens?: number
        total_tokens?: number
      }
    }

    const text = d.choices?.[0]?.message?.content ?? ''

    let structured: unknown = null
    try {
      structured = JSON.parse(text)
    } catch {
      // not JSON — that's fine
    }

    const cost: CostInfo | undefined = d.usage
      ? {
          input_tokens: d.usage.prompt_tokens,
          output_tokens: d.usage.completion_tokens,
          total_tokens: d.usage.total_tokens,
        }
      : undefined

    return {
      output: text,
      structured,
      exit_code: 0,
      duration_ms: 0,
      cost,
    }
  }
}
