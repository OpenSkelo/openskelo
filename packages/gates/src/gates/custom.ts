import type { GateResult, CustomGate } from '../types.js'

export async function customGate(
  data: unknown,
  raw: unknown,
  config: CustomGate,
): Promise<GateResult> {
  const gate = config.name ?? 'custom'
  const start = performance.now()

  try {
    const userResult = await config.fn(data, raw)
    const duration_ms = performance.now() - start

    return {
      ...userResult,
      gate,
      duration_ms,
    }
  } catch (err) {
    const duration_ms = performance.now() - start
    const message = err instanceof Error ? err.message : String(err)

    return {
      gate,
      passed: false,
      reason: `Custom gate error: ${message}`,
      details: { error: message },
      duration_ms,
    }
  }
}
