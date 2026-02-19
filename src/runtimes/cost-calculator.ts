const MODEL_PRICING: Record<string, { input: number; output: number }> = {
  "claude-haiku-4-5": { input: 0.8, output: 4.0 },
  "claude-sonnet-4-5": { input: 3.0, output: 15.0 },
  "claude-opus-4-6": { input: 15.0, output: 75.0 },
  "gpt-4o-mini": { input: 0.15, output: 0.6 },
  "gpt-4o": { input: 2.5, output: 10.0 },
};

const UNKNOWN_MODEL_WARNED = new Set<string>();

export function calculateCost(
  model: string,
  usage: { inputTokens: number; outputTokens: number }
): number {
  const pricing = MODEL_PRICING[model];
  if (!pricing) {
    if (!UNKNOWN_MODEL_WARNED.has(model)) {
      UNKNOWN_MODEL_WARNED.add(model);
      console.warn(`[cost] Unknown model '${model}' — cost tracking unavailable. Add pricing to cost-calculator.ts`);
    }
    return 0;
  }

  const inputCost = (usage.inputTokens / 1_000_000) * pricing.input;
  const outputCost = (usage.outputTokens / 1_000_000) * pricing.output;
  return Math.round((inputCost + outputCost) * 1_000_000) / 1_000_000;
}

export function getKnownModelPricing() {
  return { ...MODEL_PRICING };
}
