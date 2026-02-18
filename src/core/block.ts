/**
 * Block module barrel.
 * Split modules:
 * - block-types
 * - block-helpers
 * - expression-eval
 * - gate-evaluator
 * - dag-parser
 * - block-engine
 */

export type * from "./block-types.js";

export { createBlockEngine } from "./block-engine.js";
export { parseDAG } from "./dag-parser.js";
export { evaluateBlockGate } from "./gate-evaluator.js";
export { evaluateSafeExpression } from "./expression-eval.js";
