export const VERSION = '0.0.1'

// Gate implementations
export { jsonSchemaGate } from './gates/json-schema.js'
export { expressionGate } from './gates/expression.js'
export { regexGate } from './gates/regex.js'
export { wordCountGate } from './gates/word-count.js'

// Utilities
export { safeEval } from './utils/safe-eval.js'

// Types
export type {
  GateResult,
  GateDefinition,
  JsonSchemaGate,
  ExpressionGate,
  RegexGate,
  WordCountGate,
  CommandGate,
  LlmReviewGate,
  CustomGate,
} from './types.js'
