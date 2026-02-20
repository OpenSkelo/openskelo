import type { BlockGate, GateResult } from "./block-types.js";
import {
  evaluateBlockGate as evaluateBlockGateFromPackage,
  type BlockGate as PackageBlockGate,
  type GateResult as PackageGateResult,
} from "@openskelo/gates";

type Assert<T extends true> = T;

// Compile-time compatibility guard between core and package gate shapes.
type _BlockGateCompatA = Assert<PackageBlockGate extends BlockGate ? true : false>;
type _BlockGateCompatB = Assert<BlockGate extends PackageBlockGate ? true : false>;
type _GateResultCompatA = Assert<PackageGateResult extends GateResult ? true : false>;
type _GateResultCompatB = Assert<GateResult extends PackageGateResult ? true : false>;

export function evaluateBlockGate(
  gate: BlockGate,
  inputs: Record<string, unknown>,
  outputs: Record<string, unknown>
): GateResult {
  const packageGate: PackageBlockGate = gate;
  const packageResult = evaluateBlockGateFromPackage(packageGate, inputs, outputs);
  const coreResult: GateResult = packageResult;
  return coreResult;
}
