import type { CustomGate, GateResult } from '../types.js'

export async function evaluateCustomGate(gate: CustomGate, input: unknown, raw?: string): Promise<GateResult> {
  const started = Date.now()

  try {
    const output = await gate.fn(input, raw)

    if (typeof output === 'boolean') {
      return {
        gate: gate.name ?? gate.type,
        passed: output,
        reason: output ? undefined : 'Custom gate returned false',
        duration_ms: Date.now() - started
      }
    }

    if (typeof output === 'object' && output !== null && 'passed' in output) {
      const result = output as GateResult
      return {
        gate: gate.name ?? result.gate ?? gate.type,
        passed: result.passed,
        reason: result.reason,
        details: result.details,
        duration_ms: Date.now() - started
      }
    }

    return {
      gate: gate.name ?? gate.type,
      passed: false,
      reason: 'Custom gate returned invalid result',
      duration_ms: Date.now() - started
    }
  } catch (err) {
    return {
      gate: gate.name ?? gate.type,
      passed: false,
      reason: err instanceof Error ? err.message : 'Custom gate threw an error',
      duration_ms: Date.now() - started
    }
  }
}
