import type { BlockGate, GateResult } from "./block-types.js";
import {
  evaluateBlockGates as evaluateBlockGatesFromPackage,
  type LLMReviewHandler,
  type LLMReviewHandlerResult,
  type BlockGate as PackageBlockGate,
  type GateResult as PackageGateResult,
} from "@openskelo/gates";

type Assert<T extends true> = T;

// Compile-time compatibility guard between core and package gate shapes.
type _BlockGateCompatA = Assert<PackageBlockGate extends BlockGate ? true : false>;
type _BlockGateCompatB = Assert<BlockGate extends PackageBlockGate ? true : false>;
type _GateResultCompatA = Assert<PackageGateResult extends GateResult ? true : false>;
type _GateResultCompatB = Assert<GateResult extends PackageGateResult ? true : false>;

export type { LLMReviewHandler, LLMReviewHandlerResult };

export async function evaluateBlockGates(
  gates: BlockGate[],
  ctx: {
    inputs: Record<string, unknown>;
    outputs: Record<string, unknown>;
    llmReview?: LLMReviewHandler;
  }
): Promise<GateResult[]> {
  const packageGates: PackageBlockGate[] = gates;
  const packageResults = await evaluateBlockGatesFromPackage(packageGates, ctx);
  const coreResults: GateResult[] = packageResults;
  return coreResults;
}
