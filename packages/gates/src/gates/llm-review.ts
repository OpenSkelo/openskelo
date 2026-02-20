import type { GateResult, LlmReviewGate } from '../types.js'

export async function llmReviewGate(
  data: unknown,
  config: LlmReviewGate,
): Promise<GateResult> {
  const gate = config.name ?? 'llm_review'
  const start = performance.now()
  const threshold = config.threshold ?? 0.8

  if (!config.provider) {
    return {
      gate,
      passed: false,
      reason: 'No LLM provider configured for llm_review gate',
      duration_ms: performance.now() - start,
    }
  }

  try {
    const output = typeof data === 'string' ? data : JSON.stringify(data)
    const reviewResult = await config.provider.review({
      output,
      criteria: config.criteria,
    })

    const duration_ms = performance.now() - start
    const score = reviewResult.score
    const passed = score >= threshold

    if (passed) {
      return {
        gate,
        passed: true,
        details: {
          score,
          criteria_results: reviewResult.criteria_results,
        },
        duration_ms,
        cost: reviewResult.cost,
      }
    }

    const failedCriteria = reviewResult.criteria_results
      .filter((c) => !c.passed)
      .map((c) => `${c.criterion}: ${c.reasoning}`)
      .join('; ')

    return {
      gate,
      passed: false,
      reason: `LLM review score ${score.toFixed(2)} below threshold ${threshold}: ${failedCriteria}`,
      details: {
        score,
        threshold,
        criteria_results: reviewResult.criteria_results,
      },
      duration_ms,
      cost: reviewResult.cost,
    }
  } catch (err) {
    const duration_ms = performance.now() - start
    const message = err instanceof Error ? err.message : String(err)

    return {
      gate,
      passed: false,
      reason: `LLM review error: ${message}`,
      details: { error: message },
      duration_ms,
    }
  }
}
