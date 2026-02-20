import type { ZodSchema } from 'zod'

// ═══ Gate Results ═══

export interface GateResult {
  gate: string
  passed: boolean
  reason?: string
  details?: any
  duration_ms: number
  cost?: number
}

export interface AttemptRecord {
  attempt: number
  gates: GateResult[]
  passed: boolean
  feedback_sent?: string
  duration_ms: number
}

// ═══ Core Types ═══

export interface GatedOptions<T = unknown> {
  gates: GateDefinition[]
  retry?: RetryConfig
  extract?: 'json' | 'text' | 'auto' | ((raw: any) => T)
  timeout?: number
  onAttempt?: (attempt: AttemptEvent) => void
}

export interface GatedResult<T = unknown> {
  data: T
  raw: any
  attempts: number
  gates: GateResult[]
  history: AttemptRecord[]
  duration_ms: number
}

export interface RetryConfig {
  max: number
  feedback: boolean
  delay_ms?: number
  backoff?: boolean
}

export interface RetryContext {
  attempt: number
  feedback: string
  failures: GateResult[]
}

export interface AttemptEvent {
  attempt: number
  gates: GateResult[]
  passed: boolean
  duration_ms: number
}

// ═══ Simple JSON Schema ═══

export interface SimpleJsonSchema {
  type?: 'object' | 'array' | 'string' | 'number' | 'boolean' | 'null'
  required?: string[]
  properties?: Record<string, SimpleJsonSchema>
  items?: SimpleJsonSchema
}

// ═══ Gate Definitions ═══

export interface JsonSchemaGate {
  type: 'json_schema'
  schema: ZodSchema | SimpleJsonSchema
  name?: string
}

export interface ExpressionGate {
  type: 'expression'
  expr: string
  name?: string
}

export interface RegexGate {
  type: 'regex'
  pattern: string
  flags?: string
  invert?: boolean
  name?: string
}

export interface WordCountGate {
  type: 'word_count'
  min?: number
  max?: number
  name?: string
}

export interface CommandGate {
  type: 'command'
  run: string
  expect_exit?: number
  cwd?: string
  timeout_ms?: number
  env?: Record<string, string>
  name?: string
}

export interface LlmReviewGate {
  type: 'llm_review'
  criteria: string[]
  provider?: LlmProvider
  model?: string
  threshold?: number
  name?: string
}

export interface CustomGate {
  type: 'custom'
  fn: (data: any, raw: any) => Promise<GateResult> | GateResult
  name?: string
}

export type GateDefinition =
  | JsonSchemaGate
  | ExpressionGate
  | RegexGate
  | WordCountGate
  | CommandGate
  | LlmReviewGate
  | CustomGate

// ═══ LLM Review Provider ═══

export interface LlmProvider {
  name: string
  review(input: LlmReviewInput): Promise<LlmReviewOutput>
}

export interface LlmReviewInput {
  output: string
  criteria: string[]
  original_prompt?: string
}

export interface LlmReviewOutput {
  passed: boolean
  score: number
  criteria_results: {
    criterion: string
    passed: boolean
    reasoning: string
  }[]
  cost: number
}

// ═══ Custom Errors ═══

export class GateFailureError extends Error {
  constructor(
    message: string,
    public readonly results: GateResult[],
  ) {
    super(message)
    this.name = 'GateFailureError'
  }
}

export class GateExhaustionError extends Error {
  constructor(
    public readonly history: AttemptRecord[],
    public readonly lastFailures: GateResult[] = [],
  ) {
    const attempts = history.length
    const failureNames = lastFailures.map((f) => f.gate).join(', ')
    super(
      `All ${attempts} attempt${attempts > 1 ? 's' : ''} exhausted. ` +
      `Last failures: ${failureNames || 'unknown'}`,
    )
    this.name = 'GateExhaustionError'
  }
}
