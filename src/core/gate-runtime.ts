import type { BlockGate, GateResult } from "./block-types.js";
import {
  evaluateBlockGates as evaluateBlockGatesFromPackage,
  type LLMReviewHandler,
  type LLMReviewHandlerResult,
  type BlockGate as PackageBlockGate,
  type GateResult as PackageGateResult,
} from "@openskelo/gates";

// Compile-time compatibility guard between core and package gate result shapes.
type _GateResultCompatA = PackageGateResult extends GateResult ? true : never;
type _GateResultCompatB = GateResult extends PackageGateResult ? true : never;
const _gateResultCompatA: _GateResultCompatA = true;
const _gateResultCompatB: _GateResultCompatB = true;
void _gateResultCompatA;
void _gateResultCompatB;

export type { LLMReviewHandler, LLMReviewHandlerResult };

export async function evaluateBlockGates(
  gates: BlockGate[],
  ctx: {
    inputs: Record<string, unknown>;
    outputs: Record<string, unknown>;
    llmReview?: LLMReviewHandler;
  }
): Promise<GateResult[]> {
  return await evaluateBlockGatesFromPackage(gates as unknown as PackageBlockGate[], ctx);
}
