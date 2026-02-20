export const VERSION = '0.0.1'

// Public API
export { gated } from './gated.js'
export { createGateRunner } from './runner.js'
export { retry, compileFeedback } from './retry.js'

// Gate implementations
export { jsonSchemaGate } from './gates/json-schema.js'
export { expressionGate } from './gates/expression.js'
export { regexGate } from './gates/regex.js'
export { wordCountGate } from './gates/word-count.js'
export { commandGate } from './gates/command.js'
export { llmReviewGate } from './gates/llm-review.js'
export { customGate } from './gates/custom.js'

// Utilities
export { safeEval } from './utils/safe-eval.js'
export { parseOutput } from './utils/parse-output.js'

// Errors
export { GateFailureError, GateExhaustionError } from './types.js'

// Types
export type {
  GateResult,
  GateDefinition,
  GatedOptions,
  GatedResult,
  RetryConfig,
  RetryContext,
  AttemptRecord,
  AttemptEvent,
  JsonSchemaGate,
  ExpressionGate,
  RegexGate,
  WordCountGate,
  CommandGate,
  LlmReviewGate,
  CustomGate,
  LlmProvider,
  LlmReviewInput,
  LlmReviewOutput,
  SimpleJsonSchema,
} from './types.js'

export type { GateRunner, GateRunnerOptions } from './runner.js'
export type { RetryOptions } from './retry.js'
