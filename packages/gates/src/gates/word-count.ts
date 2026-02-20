import type { GateResult, WordCountGate } from '../types.js'

function countWords(text: string): number {
  const trimmed = text.trim()
  if (trimmed === '') return 0
  return trimmed.split(/\s+/).length
}

export async function wordCountGate(
  data: string,
  config: WordCountGate,
): Promise<GateResult> {
  const gate = config.name ?? 'word_count'
  const start = performance.now()

  const text = typeof data === 'string' ? data : String(data)
  const count = countWords(text)
  const duration_ms_fn = () => performance.now() - start

  if (config.min !== undefined && count < config.min) {
    return {
      gate,
      passed: false,
      reason: `Word count ${count} is below min ${config.min}`,
      details: { count, min: config.min, max: config.max },
      duration_ms: duration_ms_fn(),
    }
  }

  if (config.max !== undefined && count > config.max) {
    return {
      gate,
      passed: false,
      reason: `Word count ${count} exceeds max ${config.max}`,
      details: { count, min: config.min, max: config.max },
      duration_ms: duration_ms_fn(),
    }
  }

  return {
    gate,
    passed: true,
    details: { count, min: config.min, max: config.max },
    duration_ms: duration_ms_fn(),
  }
}
