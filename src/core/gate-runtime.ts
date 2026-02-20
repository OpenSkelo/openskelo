import type { BlockGate, GateResult } from "./block-types.js";
import { evaluateBlockGate } from "./gate-evaluator.js";

export interface LLMReviewHandlerResult {
  success: boolean;
  output?: string;
  error?: string;
  tokensUsed?: number;
  audit?: Record<string, unknown>;
}

export type LLMReviewHandler = (args: {
  gate: BlockGate & { check: Extract<BlockGate["check"], { type: "llm_review" }> };
  systemPrompt: string;
  reviewPrompt: string;
}) => Promise<LLMReviewHandlerResult>;

export async function evaluateBlockGates(
  gates: BlockGate[],
  ctx: {
    inputs: Record<string, unknown>;
    outputs: Record<string, unknown>;
    llmReview?: LLMReviewHandler;
  }
): Promise<GateResult[]> {
  const results: GateResult[] = [];

  for (const gate of gates) {
    if (gate.check.type !== "llm_review") {
      results.push(evaluateBlockGate(gate, ctx.inputs, ctx.outputs));
      continue;
    }

    const ports = { ...ctx.inputs, ...ctx.outputs };
    const candidate = ports[gate.check.port];
    if (candidate === undefined || candidate === null || String(candidate).trim() === "") {
      results.push({
        name: gate.name,
        passed: false,
        reason: `${gate.error} (target port '${gate.check.port}' is empty)`,
        audit: { gate_type: "llm_review", status: "failed", failure: "empty_port" },
      });
      continue;
    }

    if (!ctx.llmReview) {
      results.push({
        name: gate.name,
        passed: false,
        reason: `${gate.error} (llm_review handler not configured)`,
        audit: { gate_type: "llm_review", status: "failed", failure: "handler_not_configured" },
      });
      continue;
    }

    const criteria = gate.check.criteria;
    const passThreshold = Number(gate.check.pass_threshold ?? 1);
    const systemPrompt = gate.check.system_prompt ?? "You are a strict quality reviewer.";
    const reviewPrompt = [
      "Evaluate the following output against each criterion.",
      "Respond with ONLY valid JSON array; each element must have: criterion, passed (boolean), reasoning.",
      "",
      "OUTPUT:",
      "---",
      String(candidate),
      "---",
      "",
      "CRITERIA:",
      ...criteria.map((c, i) => `${i + 1}. ${c}`),
      "",
      "Example:",
      '[{"criterion":"Code handles errors","passed":true,"reasoning":"Try/catch present."}]',
    ].join("\n");

    const reviewStart = Date.now();

    try {
      const review = await ctx.llmReview({
        gate: gate as BlockGate & { check: Extract<BlockGate["check"], { type: "llm_review" }> },
        systemPrompt,
        reviewPrompt,
      });

      if (!review.success) {
        results.push({
          name: gate.name,
          passed: false,
          reason: `${gate.error} (review dispatch failed: ${review.error ?? "unknown"})`,
          audit: {
            gate_type: "llm_review",
            status: "failed",
            failure: "dispatch_failed",
            criteria_count: criteria.length,
            pass_threshold: passThreshold,
            review_prompt: reviewPrompt,
            raw_response: review.output ?? "",
            tokens_used: review.tokensUsed ?? 0,
            duration_ms: Date.now() - reviewStart,
            ...(review.audit ?? {}),
          },
        });
        continue;
      }

      const parsed = parseReviewJson(review.output ?? "");
      if (!parsed.ok) {
        results.push({
          name: gate.name,
          passed: false,
          reason: `${gate.error} (review output invalid JSON schema)`,
          audit: {
            gate_type: "llm_review",
            status: "failed",
            failure: "invalid_review_output",
            raw_preview: String(review.output ?? "").slice(0, 400),
            ...(review.audit ?? {}),
          },
        });
        continue;
      }

      const passedCount = parsed.criteria.filter((c) => c.passed).length;
      const score = parsed.criteria.length === 0 ? 0 : passedCount / parsed.criteria.length;
      const ok = score >= passThreshold;

      results.push({
        name: gate.name,
        passed: ok,
        reason: ok ? undefined : `${gate.error} (${passedCount}/${parsed.criteria.length} criteria passed)`,
        audit: {
          gate_type: "llm_review",
          status: ok ? "passed" : "failed",
          pass_threshold: passThreshold,
          score,
          passed_count: passedCount,
          criteria_count: parsed.criteria.length,
          overall_passed: ok,
          verdicts: parsed.criteria,
          summary: parsed.summary,
          review_prompt: reviewPrompt,
          raw_response: review.output ?? "",
          tokens_used: review.tokensUsed ?? 0,
          duration_ms: Date.now() - reviewStart,
          ...(review.audit ?? {}),
        },
      });
    } catch (err) {
      results.push({
        name: gate.name,
        passed: false,
        reason: `${gate.error} (${err instanceof Error ? err.message : "review exception"})`,
        audit: {
          gate_type: "llm_review",
          status: "failed",
          failure: "exception",
        },
      });
    }
  }

  return results;
}

function parseReviewJson(raw: string): { ok: true; criteria: Array<{ criterion: string; passed: boolean; reasoning: string }>; summary?: string } | { ok: false } {
  const candidates: string[] = [raw];
  const code = raw.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
  if (code?.[1]) candidates.push(code[1]);

  for (const candidate of candidates) {
    try {
      const parsedAny = JSON.parse(candidate) as unknown;
      const parsed = parsedAny as Record<string, unknown>;

      const arr = Array.isArray(parsedAny)
        ? parsedAny
        : (Array.isArray(parsed?.criteria) ? parsed.criteria : null);
      if (!arr) continue;

      const criteria = arr
        .map((c) => c as Record<string, unknown>)
        .filter((c) => typeof c.criterion === "string" && typeof c.passed === "boolean")
        .map((c) => ({
          criterion: String(c.criterion),
          passed: Boolean(c.passed),
          reasoning: typeof c.reasoning === "string"
            ? c.reasoning
            : (typeof c.reason === "string" ? c.reason : ""),
        }));
      if (criteria.length === 0) continue;

      const summary = !Array.isArray(parsedAny) && typeof parsed.summary === "string" ? parsed.summary : undefined;
      return { ok: true, criteria, summary };
    } catch {
      // try next candidate
    }
  }

  return { ok: false };
}
