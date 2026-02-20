import type { GateResult, LlmProvider, LlmReviewGate } from '../types.js'

interface LlmReviewOptions {
  provider?: LlmProvider
  originalPrompt?: string
}

export async function evaluateLlmReviewGate(
  gate: LlmReviewGate,
  input: unknown,
  options: LlmReviewOptions = {}
): Promise<GateResult> {
  const started = Date.now()
  const provider = gate.provider ?? options.provider

  if (!provider) {
    return {
      gate: gate.name ?? gate.type,
      passed: false,
      reason: 'No LLM provider configured',
      duration_ms: Date.now() - started
    }
  }

  const response = await provider.review({
    output: typeof input === 'string' ? input : JSON.stringify(input),
    criteria: gate.criteria,
    original_prompt: options.originalPrompt
  })

  const threshold = gate.threshold ?? 0.8
  const passed = response.passed && response.score >= threshold

  return {
    gate: gate.name ?? gate.type,
    passed,
    reason: passed ? undefined : `LLM review score ${response.score.toFixed(2)} below threshold ${threshold}`,
    details: {
      score: response.score,
      threshold,
      criteria_results: response.criteria_results,
      cost: response.cost,
      provider: provider.name,
      model: gate.model
    },
    duration_ms: Date.now() - started
  }
}
