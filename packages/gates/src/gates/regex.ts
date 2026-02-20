import type { GateResult, RegexGate } from '../types.js'

export async function regexGate(
  data: string,
  config: RegexGate,
): Promise<GateResult> {
  const gate = config.name ?? 'regex'
  const start = performance.now()

  let regex: RegExp
  try {
    regex = new RegExp(config.pattern, config.flags ?? '')
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return {
      gate,
      passed: false,
      reason: `Invalid regex pattern: ${message}`,
      details: { pattern: config.pattern, error: message },
      duration_ms: performance.now() - start,
    }
  }

  const text = typeof data === 'string' ? data : String(data)
  const matches = regex.test(text)
  const invert = config.invert ?? false
  const passed = invert ? !matches : matches
  const duration_ms = performance.now() - start

  if (passed) {
    return { gate, passed: true, duration_ms }
  }

  const reason = invert
    ? `Pattern /${config.pattern}/${config.flags ?? ''} matched but should not (invert mode)`
    : `Pattern /${config.pattern}/${config.flags ?? ''} did not match`

  return {
    gate,
    passed: false,
    reason,
    details: { pattern: config.pattern, flags: config.flags, invert, matched: matches },
    duration_ms,
  }
}
