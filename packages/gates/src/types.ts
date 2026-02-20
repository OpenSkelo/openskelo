import type { ZodTypeAny } from 'zod'

export interface GateResult {
  gate: string
  passed: boolean
  reason?: string
  details?: unknown
  duration_ms: number
}

export interface RetryConfig {
  max: number
  feedback: boolean
  delay_ms?: number
  backoff?: 'none' | 'linear' | 'exponential'
}

export interface RetryContext {
  attempt: number
  feedback?: string
  failures: GateResult[]
}

export interface AttemptRecord {
  attempt: number
  gates: GateResult[]
  passed: boolean
  feedback_sent?: string
  duration_ms: number
}

export interface LlmReviewCriterionResult {
  criterion: string
  passed: boolean
  score?: number
  reason?: string
}

export interface LlmReviewInput {
  output: string
  criteria: string[]
  original_prompt?: string
}

export interface LlmReviewOutput {
  passed: boolean
  score: number
  criteria_results: LlmReviewCriterionResult[]
  cost?: {
    input_tokens?: number
    output_tokens?: number
    total_tokens?: number
    usd?: number
  }
}

export interface LlmProvider {
  name: string
  review(input: LlmReviewInput): Promise<LlmReviewOutput>
}

export interface SimpleJsonSchema {
  type?: 'object' | 'array' | 'string' | 'number' | 'boolean' | 'null'
  required?: string[]
  properties?: Record<string, SimpleJsonSchema>
  items?: SimpleJsonSchema
}

export interface BaseGate {
  name?: string
}

export interface JsonSchemaGate extends BaseGate {
  type: 'json_schema'
  schema: ZodTypeAny | SimpleJsonSchema
}

export interface ExpressionGate extends BaseGate {
  type: 'expression'
  expr: string
}

export interface RegexGate extends BaseGate {
  type: 'regex'
  pattern: string
  flags?: string
  invert?: boolean
}

export interface WordCountGate extends BaseGate {
  type: 'word_count'
  min?: number
  max?: number
}

export interface CommandGate extends BaseGate {
  type: 'command'
  run: string
  expect_exit?: number
  cwd?: string
  timeout_ms?: number
  env?: Record<string, string>
}

export interface LlmReviewGate extends BaseGate {
  type: 'llm_review'
  criteria: string[]
  provider?: LlmProvider
  model?: string
  threshold?: number
}

export interface CustomGate extends BaseGate {
  type: 'custom'
  fn: (input: unknown, raw?: string) => boolean | GateResult | Promise<boolean | GateResult>
}

export type GateDefinition =
  | JsonSchemaGate
  | ExpressionGate
  | RegexGate
  | WordCountGate
  | CommandGate
  | LlmReviewGate
  | CustomGate

export type Extractor<T> = 'json' | 'text' | 'auto' | ((raw: string) => T | Promise<T>)

export interface GatedOptions<T> {
  gates: GateDefinition[]
  retry?: RetryConfig
  extract?: Extractor<T>
  timeout?: number
  onAttempt?: (attempt: AttemptRecord) => void | Promise<void>
}

export interface GatedResult<T> {
  data: T
  raw: string
  attempts: number
  gates: GateResult[]
  history: AttemptRecord[]
  duration_ms: number
}

export interface GateRunnerOptions {
  mode?: 'short-circuit' | 'all'
}

export interface GateEvaluationContext {
  raw?: string
  llmProvider?: LlmProvider
  originalPrompt?: string
}
