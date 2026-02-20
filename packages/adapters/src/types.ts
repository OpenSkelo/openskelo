import type { RetryContext } from '@openskelo/gates'

export type { RetryContext }

// ── Cost tracking ──

export interface CostInfo {
  input_tokens?: number
  output_tokens?: number
  total_tokens?: number
  usd?: number
}

// ── Adapter result ──

export interface AdapterResult {
  output: string
  structured?: unknown
  files_changed?: string[]
  diff?: string
  exit_code: number
  duration_ms: number
  cost?: CostInfo
}

// ── Adapter config ──

export interface AdapterConfig {
  command?: string
  args?: string[]
  cwd?: string
  env?: Record<string, string>
  model?: string
  provider?: string
  timeout_ms?: number
}

// ── Task input ──

export interface BounceContext {
  bounce_count: number
  feedback: { what: string; where: string; fix: string }[]
}

export interface TaskRetryContext {
  attempt: number
  feedback: string
  failures: unknown[]
}

export interface TaskInput {
  id: string
  type: string
  summary: string
  prompt: string
  acceptance_criteria?: string[]
  definition_of_done?: string[]
  backend: string
  backend_config?: AdapterConfig
  upstream_results?: Record<string, unknown>
  retry_context?: TaskRetryContext
  bounce_context?: BounceContext
}

// ── Execution adapter interface ──

export interface ExecutionAdapter {
  name: string
  taskTypes: string[]
  canHandle(task: TaskInput): boolean
  execute(task: TaskInput, retryCtx?: RetryContext): Promise<AdapterResult>
  abort(taskId: string): Promise<void>
}
