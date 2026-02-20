import type { ExpressionGate, GateResult } from '../types.js'
import { safeEval } from '../utils/safe-eval.js'

export function evaluateExpressionGate(gate: ExpressionGate, input: unknown, raw?: string): GateResult {
  const started = Date.now()

  try {
    const context = {
      input,
      data: input,
      raw: raw ?? (typeof input === 'string' ? input : JSON.stringify(input ?? ''))
    }
    const result = safeEval(gate.expr, context)

    return {
      gate: gate.name ?? gate.type,
      passed: Boolean(result),
      reason: Boolean(result) ? undefined : 'Expression evaluated to false',
      details: { expr: gate.expr, value: result },
      duration_ms: Date.now() - started
    }
  } catch (err) {
    return {
      gate: gate.name ?? gate.type,
      passed: false,
      reason: err instanceof Error ? err.message : 'Expression evaluation failed',
      duration_ms: Date.now() - started
    }
  }
}
