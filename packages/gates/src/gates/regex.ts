import type { GateResult, RegexGate } from '../types.js'

export function evaluateRegexGate(gate: RegexGate, input: unknown): GateResult {
  const started = Date.now()

  try {
    const regex = new RegExp(gate.pattern, gate.flags)
    const text = typeof input === 'string' ? input : JSON.stringify(input)
    const matched = regex.test(text)
    const passed = gate.invert ? !matched : matched

    return {
      gate: gate.name ?? gate.type,
      passed,
      reason: passed ? undefined : `Regex ${gate.invert ? 'inversion ' : ''}check failed`,
      details: { matched, pattern: gate.pattern, flags: gate.flags ?? '' },
      duration_ms: Date.now() - started
    }
  } catch (err) {
    return {
      gate: gate.name ?? gate.type,
      passed: false,
      reason: err instanceof Error ? `Invalid regex: ${err.message}` : 'Invalid regex',
      duration_ms: Date.now() - started
    }
  }
}
