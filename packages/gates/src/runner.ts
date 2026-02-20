import type { GateDefinition, GateResult } from './types.js'
import { jsonSchemaGate } from './gates/json-schema.js'
import { expressionGate } from './gates/expression.js'
import { regexGate } from './gates/regex.js'
import { wordCountGate } from './gates/word-count.js'
import { commandGate } from './gates/command.js'
import { llmReviewGate } from './gates/llm-review.js'
import { customGate } from './gates/custom.js'

export interface GateRunnerOptions {
  shortCircuit?: boolean
}

export interface GateRunner {
  evaluate(
    data: unknown,
    raw?: unknown,
    options?: GateRunnerOptions,
  ): Promise<GateResult[]>
}

async function evaluateGate(
  gate: GateDefinition,
  data: unknown,
  raw: unknown,
): Promise<GateResult> {
  switch (gate.type) {
    case 'json_schema':
      return jsonSchemaGate(data, gate)
    case 'expression':
      return expressionGate(data, gate)
    case 'regex': {
      const text = typeof raw === 'string' ? raw : JSON.stringify(raw)
      return regexGate(text, gate)
    }
    case 'word_count': {
      const text = typeof raw === 'string' ? raw : JSON.stringify(raw)
      return wordCountGate(text, gate)
    }
    case 'command':
      return commandGate(data, gate)
    case 'llm_review': {
      const text = typeof raw === 'string' ? raw : JSON.stringify(raw)
      return llmReviewGate(text, gate)
    }
    case 'custom':
      return customGate(data, raw, gate)
  }
}

export function createGateRunner(gates: GateDefinition[]): GateRunner {
  return {
    async evaluate(
      data: unknown,
      raw?: unknown,
      options?: GateRunnerOptions,
    ): Promise<GateResult[]> {
      const shortCircuit = options?.shortCircuit ?? true
      const resolvedRaw = raw ?? (typeof data === 'string' ? data : JSON.stringify(data))
      const results: GateResult[] = []

      for (const gate of gates) {
        const result = await evaluateGate(gate, data, resolvedRaw)
        results.push(result)

        if (!result.passed && shortCircuit) {
          break
        }
      }

      return results
    },
  }
}
