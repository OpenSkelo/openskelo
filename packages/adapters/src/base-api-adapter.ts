import type {
  ExecutionAdapter,
  AdapterResult,
  AdapterConfig,
  TaskInput,
} from './types.js'
import type { RetryContext } from '@openskelo/gates'

export abstract class BaseApiAdapter implements ExecutionAdapter {
  readonly name: string
  readonly taskTypes: string[]
  protected defaultConfig: AdapterConfig
  protected fetchFn: typeof fetch
  private controllers = new Map<string, AbortController>()

  constructor(
    name: string,
    taskTypes: string[],
    defaultConfig?: AdapterConfig,
    fetchFn?: typeof fetch,
  ) {
    this.name = name
    this.taskTypes = taskTypes
    this.defaultConfig = defaultConfig ?? {}
    this.fetchFn = fetchFn ?? globalThis.fetch
  }

  abstract buildRequestUrl(task: TaskInput, config: AdapterConfig): string
  abstract buildRequestHeaders(task: TaskInput, config: AdapterConfig): Record<string, string>
  abstract buildRequestBody(task: TaskInput, config: AdapterConfig): unknown
  abstract parseResponse(data: unknown, task: TaskInput): AdapterResult

  canHandle(task: TaskInput): boolean {
    const backend = task.backend.includes('/')
      ? task.backend.split('/')[0]
      : task.backend
    return backend === this.name || this.taskTypes.includes(task.type)
  }

  async execute(task: TaskInput, _retryCtx?: RetryContext): Promise<AdapterResult> {
    const config = this.mergeConfig(task.backend_config)
    const start = performance.now()

    const controller = new AbortController()
    this.controllers.set(task.id, controller)

    const timeoutMs = config.timeout_ms ?? 120000
    const timer = setTimeout(() => controller.abort(), timeoutMs)

    try {
      const url = this.buildRequestUrl(task, config)
      const headers: Record<string, string> = {
        'content-type': 'application/json',
        ...this.buildRequestHeaders(task, config),
      }
      const body = this.buildRequestBody(task, config)

      const response = await this.fetchWithRetry(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
        signal: controller.signal,
      })

      if (!response.ok) {
        let errMessage: string
        try {
          errMessage = await response.text() || `HTTP ${response.status}`
        } catch {
          errMessage = `HTTP ${response.status}`
        }
        return {
          output: errMessage,
          exit_code: 1,
          duration_ms: performance.now() - start,
        }
      }

      const data = await response.json()
      const result = this.parseResponse(data, task)
      result.duration_ms = performance.now() - start
      return result
    } catch (err) {
      return {
        output: err instanceof Error ? err.message : String(err),
        exit_code: 1,
        duration_ms: performance.now() - start,
      }
    } finally {
      clearTimeout(timer)
      this.controllers.delete(task.id)
    }
  }

  async abort(taskId: string): Promise<void> {
    const controller = this.controllers.get(taskId)
    if (controller) {
      controller.abort()
      this.controllers.delete(taskId)
    }
  }

  protected async fetchWithRetry(
    url: string,
    options: RequestInit,
    maxRetries = 3,
  ): Promise<Response> {
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      const response = await this.fetchFn(url, options)

      if (response.status !== 429 || attempt >= maxRetries) {
        return response
      }

      const retryAfter = response.headers?.get?.('retry-after')
      const delayMs = retryAfter
        ? Math.min(parseInt(retryAfter, 10) * 1000, 30000)
        : Math.min(2 ** attempt * 1000, 10000)

      await this.delay(delayMs)
    }

    throw new Error('Max retries exceeded')
  }

  protected delay(ms: number): Promise<void> {
    return new Promise(r => setTimeout(r, ms))
  }

  protected mergeConfig(taskConfig?: AdapterConfig): AdapterConfig {
    if (!taskConfig) return { ...this.defaultConfig }
    return {
      command: taskConfig.command ?? this.defaultConfig.command,
      args: taskConfig.args ?? this.defaultConfig.args,
      cwd: taskConfig.cwd ?? this.defaultConfig.cwd,
      env: { ...this.defaultConfig.env, ...taskConfig.env },
      model: taskConfig.model ?? this.defaultConfig.model,
      provider: taskConfig.provider ?? this.defaultConfig.provider,
      timeout_ms: taskConfig.timeout_ms ?? this.defaultConfig.timeout_ms,
    }
  }
}
