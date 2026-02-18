import { describe, it, expect } from "vitest";
import { createBlockEngine } from "../src/core/block";
import type { DAGDef } from "../src/core/block";

function dagWithDiff(mode: "equal" | "not_equal" = "equal"): DAGDef {
  return {
    name: "diff-gate",
    blocks: [
      {
        id: "b1",
        name: "B1",
        inputs: {
          left: { type: "json", required: true },
          right: { type: "json", required: true },
        },
        outputs: { out: { type: "string", required: false } },
        agent: { role: "worker" },
        pre_gates: [{ name: "diff", check: { type: "diff", left: "left", right: "right", mode }, error: "diff mismatch" }],
        post_gates: [],
        retry: { max_attempts: 0, backoff: "none", delay_ms: 0 },
      },
    ],
    edges: [],
    entrypoints: ["b1"],
    terminals: ["b1"],
  };
}

describe("gate type: diff", () => {
  it("passes equality mode for equivalent objects", () => {
    const engine = createBlockEngine();
    const dag = engine.parseDAG(dagWithDiff("equal") as unknown as Record<string, unknown>);
    const results = engine.evaluatePreGates(dag.blocks[0], {
      left: { a: 1, b: [1, 2] },
      right: { b: [1, 2], a: 1 },
    });
    expect(results[0].passed).toBe(true);
  });

  it("passes not_equal mode for different values", () => {
    const engine = createBlockEngine();
    const dag = engine.parseDAG(dagWithDiff("not_equal") as unknown as Record<string, unknown>);
    const results = engine.evaluatePreGates(dag.blocks[0], {
      left: { a: 1 },
      right: { a: 2 },
    });
    expect(results[0].passed).toBe(true);
  });
});
