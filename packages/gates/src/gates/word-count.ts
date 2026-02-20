import type { GateResult, WordCountGate } from '../types.js'

function countWords(value: string): number {
  const matches = value.trim().match(/\S+/g)
  return matches ? matches.length : 0
}

export function evaluateWordCountGate(gate: WordCountGate, input: unknown): GateResult {
  const started = Date.now()
  const text = typeof input === 'string' ? input : JSON.stringify(input)
  const words = countWords(text)

  const belowMin = typeof gate.min === 'number' && words < gate.min
  const aboveMax = typeof gate.max === 'number' && words > gate.max
  const passed = !belowMin && !aboveMax

  return {
    gate: gate.name ?? gate.type,
    passed,
    reason: passed ? undefined : `Word count ${words} outside range`,
    details: { words, min: gate.min, max: gate.max },
    duration_ms: Date.now() - started
  }
}
