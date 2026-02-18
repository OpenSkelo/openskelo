import { describe, it, expect } from "vitest";
import { createBlockEngine } from "../src/core/block";
import type { DAGDef } from "../src/core/block";

function dagSemantic(minMatches = 2): DAGDef {
  return {
    name: "semantic-gate",
    blocks: [
      {
        id: "b1",
        name: "B1",
        inputs: { draft: { type: "string", required: true } },
        outputs: { out: { type: "string", required: false } },
        agent: { role: "worker" },
        pre_gates: [
          {
            name: "sem",
            check: { type: "semantic_review", port: "draft", keywords: ["security", "audit", "deterministic"], min_matches: minMatches },
            error: "semantic review failed",
          },
        ],
        post_gates: [],
        retry: { max_attempts: 0, backoff: "none", delay_ms: 0 },
      },
    ],
    edges: [],
    entrypoints: ["b1"],
    terminals: ["b1"],
  };
}

describe("gate type: semantic_review", () => {
  it("passes when enough semantic keywords are present", () => {
    const engine = createBlockEngine();
    const dag = engine.parseDAG(dagSemantic(2) as unknown as Record<string, unknown>);
    const results = engine.evaluatePreGates(dag.blocks[0], { draft: "Deterministic audit flow with strong security posture" });
    expect(results[0].passed).toBe(true);
  });

  it("fails when keyword coverage is below threshold", () => {
    const engine = createBlockEngine();
    const dag = engine.parseDAG(dagSemantic(3) as unknown as Record<string, unknown>);
    const results = engine.evaluatePreGates(dag.blocks[0], { draft: "Deterministic flow only" });
    expect(results[0].passed).toBe(false);
    expect(String(results[0].reason ?? "")).toContain("matched");
  });
});
