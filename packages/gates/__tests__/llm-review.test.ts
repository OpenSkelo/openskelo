import { describe, expect, it } from 'vitest'
import { evaluateLlmReviewGate } from '../src/gates/llm-review.js'
import type { LlmProvider, LlmReviewInput, LlmReviewOutput } from '../src/types.js'

class MockLlmProvider implements LlmProvider {
  name = 'mock-reviewer'
  lastInput: LlmReviewInput | null = null
  output: LlmReviewOutput

  constructor(output: LlmReviewOutput) {
    this.output = output
  }

  async review(input: LlmReviewInput): Promise<LlmReviewOutput> {
    this.lastInput = input
    return this.output
  }
}

describe('llm_review gate', () => {
  it('passes when all criteria pass', async () => {
    const provider = new MockLlmProvider({
      passed: true,
      score: 1,
      criteria_results: [{ criterion: 'a', passed: true }]
    })

    const result = await evaluateLlmReviewGate({ type: 'llm_review', criteria: ['a'], provider }, 'text')
    expect(result.passed).toBe(true)
  })

  it('fails when review reports failed', async () => {
    const provider = new MockLlmProvider({
      passed: false,
      score: 0.95,
      criteria_results: [{ criterion: 'a', passed: false }]
    })

    const result = await evaluateLlmReviewGate({ type: 'llm_review', criteria: ['a'], provider }, 'text')
    expect(result.passed).toBe(false)
  })

  it('uses default threshold 0.8', async () => {
    const provider = new MockLlmProvider({ passed: true, score: 0.8, criteria_results: [] })
    const result = await evaluateLlmReviewGate({ type: 'llm_review', criteria: ['a'], provider }, 'text')
    expect(result.passed).toBe(true)
  })

  it('fails below default threshold', async () => {
    const provider = new MockLlmProvider({ passed: true, score: 0.79, criteria_results: [] })
    const result = await evaluateLlmReviewGate({ type: 'llm_review', criteria: ['a'], provider }, 'text')
    expect(result.passed).toBe(false)
  })

  it('passes with custom threshold', async () => {
    const provider = new MockLlmProvider({ passed: true, score: 0.7, criteria_results: [] })
    const result = await evaluateLlmReviewGate({ type: 'llm_review', criteria: ['a'], provider, threshold: 0.7 }, 'text')
    expect(result.passed).toBe(true)
  })

  it('fails custom threshold check', async () => {
    const provider = new MockLlmProvider({ passed: true, score: 0.7, criteria_results: [] })
    const result = await evaluateLlmReviewGate({ type: 'llm_review', criteria: ['a'], provider, threshold: 0.75 }, 'text')
    expect(result.passed).toBe(false)
  })

  it('includes score in details', async () => {
    const provider = new MockLlmProvider({ passed: true, score: 0.9, criteria_results: [] })
    const result = await evaluateLlmReviewGate({ type: 'llm_review', criteria: ['a'], provider }, 'text')
    expect((result.details as { score?: number }).score).toBe(0.9)
  })

  it('includes cost tracking in details', async () => {
    const provider = new MockLlmProvider({
      passed: true,
      score: 0.9,
      criteria_results: [],
      cost: { total_tokens: 123, usd: 0.01 }
    })
    const result = await evaluateLlmReviewGate({ type: 'llm_review', criteria: ['a'], provider }, 'text')
    expect((result.details as { cost?: { total_tokens?: number } }).cost?.total_tokens).toBe(123)
  })

  it('includes per criterion results in details', async () => {
    const provider = new MockLlmProvider({
      passed: true,
      score: 0.95,
      criteria_results: [{ criterion: 'must include tests', passed: true, reason: 'found test section' }]
    })
    const result = await evaluateLlmReviewGate({ type: 'llm_review', criteria: ['must include tests'], provider }, 'text')
    expect(JSON.stringify(result.details)).toContain('must include tests')
  })

  it('includes provider name in details', async () => {
    const provider = new MockLlmProvider({ passed: true, score: 1, criteria_results: [] })
    const result = await evaluateLlmReviewGate({ type: 'llm_review', criteria: ['a'], provider }, 'text')
    expect((result.details as { provider?: string }).provider).toBe('mock-reviewer')
  })

  it('fails when no provider exists', async () => {
    const result = await evaluateLlmReviewGate({ type: 'llm_review', criteria: ['a'] }, 'text')
    expect(result.passed).toBe(false)
    expect(result.reason).toContain('No LLM provider')
  })

  it('uses custom gate name', async () => {
    const provider = new MockLlmProvider({ passed: true, score: 1, criteria_results: [] })
    const result = await evaluateLlmReviewGate({ type: 'llm_review', name: 'policy-review', criteria: ['a'], provider }, 'text')
    expect(result.gate).toBe('policy-review')
  })

  it('stores model metadata in details', async () => {
    const provider = new MockLlmProvider({ passed: true, score: 1, criteria_results: [] })
    const result = await evaluateLlmReviewGate({ type: 'llm_review', criteria: ['a'], provider, model: 'cheap-model' }, 'text')
    expect((result.details as { model?: string }).model).toBe('cheap-model')
  })

  it('stringifies non-string input for provider', async () => {
    const provider = new MockLlmProvider({ passed: true, score: 1, criteria_results: [] })
    await evaluateLlmReviewGate({ type: 'llm_review', criteria: ['a'], provider }, { hello: 'world' })
    expect(provider.lastInput?.output).toContain('hello')
  })

  it('records duration', async () => {
    const provider = new MockLlmProvider({ passed: true, score: 1, criteria_results: [] })
    const result = await evaluateLlmReviewGate({ type: 'llm_review', criteria: ['a'], provider }, 'text')
    expect(result.duration_ms).toBeGreaterThanOrEqual(0)
  })
})
