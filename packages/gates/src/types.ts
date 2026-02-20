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

// ═══ Gate Definitions ═══

export interface JsonSchemaGate {
  type: 'json_schema'
  schema: ZodSchema | { required?: string[]; properties?: Record<string, any> }
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
  provider?: any
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
