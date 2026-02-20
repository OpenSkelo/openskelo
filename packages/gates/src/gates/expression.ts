import type { GateResult, ExpressionGate } from '../types.js'
import { safeEval } from '../utils/safe-eval.js'

export async function expressionGate(
  data: unknown,
  config: ExpressionGate,
): Promise<GateResult> {
  const gate = config.name ?? 'expression'
  const start = performance.now()

  try {
    const context = (data && typeof data === 'object' && !Array.isArray(data))
      ? data as Record<string, unknown>
      : { value: data }

    const result = safeEval(config.expr, context)
    const duration_ms = performance.now() - start

    if (result) {
      return { gate, passed: true, duration_ms }
    }

    return {
      gate,
      passed: false,
      reason: `Expression failed: ${config.expr}`,
      details: { expression: config.expr, result },
      duration_ms,
    }
  } catch (err) {
    const duration_ms = performance.now() - start
    const message = err instanceof Error ? err.message : String(err)

    return {
      gate,
      passed: false,
      reason: `Expression error: ${message}`,
      details: { expression: config.expr, error: message },
      duration_ms,
    }
  }
}
