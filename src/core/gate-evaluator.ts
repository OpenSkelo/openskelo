import type { BlockGate, GateResult } from "./block-types.js";
import {
  evaluateBlockGate as evaluateBlockGateFromPackage,
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

export function evaluateBlockGate(
  gate: BlockGate,
  inputs: Record<string, unknown>,
  outputs: Record<string, unknown>
): GateResult {
  return evaluateBlockGateFromPackage(gate as unknown as PackageBlockGate, inputs, outputs);
}
