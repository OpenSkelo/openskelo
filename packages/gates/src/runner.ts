import {
  evaluateCommandGate,
  evaluateCustomGate,
  evaluateExpressionGate,
  evaluateJsonSchemaGate,
  evaluateLlmReviewGate,
  evaluateRegexGate,
  evaluateWordCountGate
} from './gates/index.js'
import type {
  GateDefinition,
  GateEvaluationContext,
  GateResult,
  GateRunnerOptions
} from './types.js'

export function createGateRunner(gates: GateDefinition[], options: GateRunnerOptions = {}) {
  const mode = options.mode ?? 'short-circuit'

  async function evaluate(data: unknown, raw?: string, context: GateEvaluationContext = {}): Promise<GateResult[]> {
    const results: GateResult[] = []

    for (const gate of gates) {
      let result: GateResult

      switch (gate.type) {
        case 'json_schema':
          result = evaluateJsonSchemaGate(gate, data)
          break
        case 'expression':
          result = evaluateExpressionGate(gate, data, raw)
          break
        case 'regex':
          result = evaluateRegexGate(gate, data)
          break
        case 'word_count':
          result = evaluateWordCountGate(gate, data)
          break
        case 'command':
          result = evaluateCommandGate(gate)
          break
        case 'llm_review':
          result = await evaluateLlmReviewGate(gate, data, {
            provider: context.llmProvider,
            originalPrompt: context.originalPrompt
          })
          break
        case 'custom':
          result = await evaluateCustomGate(gate, data, raw)
          break
        default:
          result = {
            gate: 'unknown',
            passed: false,
            reason: 'Unknown gate type',
            duration_ms: 0
          }
      }

      results.push(result)
      if (mode === 'short-circuit' && !result.passed) break
    }

    return results
  }

  return { evaluate }
}
