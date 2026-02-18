import { createBlockEngine } from "./block-engine.js";
import type { DAGDef } from "./block-types.js";

// Phase-1 extraction: parser entrypoint.
export function parseDAG(raw: Record<string, unknown>): DAGDef {
  return createBlockEngine().parseDAG(raw);
}
