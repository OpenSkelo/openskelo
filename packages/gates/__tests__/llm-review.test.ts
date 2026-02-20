import { describe, it, expect } from 'vitest'
import { llmReviewGate } from '../src/gates/llm-review.js'
import type { LlmProvider, LlmReviewInput, LlmReviewOutput } from '../src/types.js'

function createMockProvider(overrides: Partial<LlmReviewOutput> = {}): LlmProvider {
  return {
    name: 'mock',
    async review(input: LlmReviewInput): Promise<LlmReviewOutput> {
      const criteria_results = input.criteria.map((c) => ({
        criterion: c,
        passed: true,
        reasoning: `${c} looks good`,
      }))
      return {
        passed: true,
        score: 1.0,
        criteria_results,
        cost: 0.001,
        ...overrides,
      }
    },
  }
}

function createScoringProvider(scores: Record<string, boolean>): LlmProvider {
  return {
    name: 'scoring-mock',
    async review(input: LlmReviewInput): Promise<LlmReviewOutput> {
      const criteria_results = input.criteria.map((c) => ({
        criterion: c,
        passed: scores[c] ?? true,
        reasoning: scores[c] !== false ? `${c} passed` : `${c} failed`,
      }))
      const passedCount = criteria_results.filter((r) => r.passed).length
      const score = passedCount / criteria_results.length
      return {
        passed: score >= 0.8,
        score,
        criteria_results,
        cost: 0.002,
      }
    },
  }
}

describe('llm_review gate', () => {
  // ── All criteria pass ──

  describe('all criteria pass', () => {
    it('passes when all criteria are met', async () => {
      const provider = createMockProvider()
      const result = await llmReviewGate(
        'Some AI output text',
        {
          type: 'llm_review',
          criteria: ['Is factual', 'Has proper grammar'],
          provider,
        },
      )
      expect(result.passed).toBe(true)
      expect(result.gate).toBe('llm_review')
    })

    it('includes cost in result', async () => {
      const provider = createMockProvider({ cost: 0.005 })
      const result = await llmReviewGate(
        'Output text',
        { type: 'llm_review', criteria: ['test'], provider },
      )
      expect(result.cost).toBe(0.005)
    })

    it('includes criteria details', async () => {
      const provider = createMockProvider()
      const result = await llmReviewGate(
        'Output text',
        {
          type: 'llm_review',
          criteria: ['Criteria A', 'Criteria B'],
          provider,
        },
      )
      expect(result.details?.criteria_results).toHaveLength(2)
    })
  })

  // ── Some criteria fail ──

  describe('partial failures', () => {
    it('fails when score is below default threshold (0.8)', async () => {
      const provider = createScoringProvider({
        'Is factual': true,
        'Has sources': false,
        'Proper grammar': false,
      })
      const result = await llmReviewGate(
        'Output text',
        {
          type: 'llm_review',
          criteria: ['Is factual', 'Has sources', 'Proper grammar'],
          provider,
        },
      )
      // 1/3 = 0.33, below 0.8 threshold
      expect(result.passed).toBe(false)
    })

    it('includes failure reasons', async () => {
      const provider = createScoringProvider({
        'Check A': true,
        'Check B': false,
      })
      const result = await llmReviewGate(
        'Output text',
        {
          type: 'llm_review',
          criteria: ['Check A', 'Check B'],
          provider,
        },
      )
      expect(result.reason).toContain('Check B')
    })

    it('shows score in details', async () => {
      const provider = createScoringProvider({
        'A': true,
        'B': false,
      })
      const result = await llmReviewGate(
        'Output',
        { type: 'llm_review', criteria: ['A', 'B'], provider },
      )
      expect(result.details?.score).toBe(0.5)
    })
  })

  // ── Threshold ──

  describe('threshold', () => {
    it('passes when score meets custom threshold', async () => {
      const provider = createScoringProvider({
        'A': true,
        'B': false,
      })
      const result = await llmReviewGate(
        'Output',
        {
          type: 'llm_review',
          criteria: ['A', 'B'],
          provider,
          threshold: 0.5,
        },
      )
      expect(result.passed).toBe(true)
    })

    it('fails when score is below custom threshold', async () => {
      const provider = createScoringProvider({
        'A': true,
        'B': false,
        'C': false,
      })
      const result = await llmReviewGate(
        'Output',
        {
          type: 'llm_review',
          criteria: ['A', 'B', 'C'],
          provider,
          threshold: 0.5,
        },
      )
      // 1/3 ≈ 0.33, below 0.5
      expect(result.passed).toBe(false)
    })

    it('uses 0.8 as default threshold', async () => {
      const provider = createScoringProvider({
        'A': true,
        'B': true,
        'C': true,
        'D': true,
        'E': false,
      })
      const result = await llmReviewGate(
        'Output',
        {
          type: 'llm_review',
          criteria: ['A', 'B', 'C', 'D', 'E'],
          provider,
        },
      )
      // 4/5 = 0.8, meets threshold
      expect(result.passed).toBe(true)
    })
  })

  // ── Provider error handling ──

  describe('error handling', () => {
    it('fails when provider throws', async () => {
      const provider: LlmProvider = {
        name: 'failing',
        async review() {
          throw new Error('API rate limit')
        },
      }
      const result = await llmReviewGate(
        'Output',
        { type: 'llm_review', criteria: ['test'], provider },
      )
      expect(result.passed).toBe(false)
      expect(result.reason).toContain('API rate limit')
    })

    it('fails when no provider given', async () => {
      const result = await llmReviewGate(
        'Output',
        { type: 'llm_review', criteria: ['test'] },
      )
      expect(result.passed).toBe(false)
      expect(result.reason).toMatch(/provider/i)
    })
  })

  // ── Metadata ──

  describe('metadata', () => {
    it('uses custom name', async () => {
      const provider = createMockProvider()
      const result = await llmReviewGate(
        'Output',
        { type: 'llm_review', criteria: ['test'], provider, name: 'quality check' },
      )
      expect(result.gate).toBe('quality check')
    })

    it('tracks duration_ms', async () => {
      const provider = createMockProvider()
      const result = await llmReviewGate(
        'Output',
        { type: 'llm_review', criteria: ['test'], provider },
      )
      expect(typeof result.duration_ms).toBe('number')
      expect(result.duration_ms).toBeGreaterThanOrEqual(0)
    })

    it('tracks cost from provider', async () => {
      const provider = createMockProvider({ cost: 0.0042 })
      const result = await llmReviewGate(
        'Output',
        { type: 'llm_review', criteria: ['test'], provider },
      )
      expect(result.cost).toBe(0.0042)
    })
  })
})
