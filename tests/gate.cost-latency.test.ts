import { describe, it, expect } from "vitest";
import { createBlockEngine } from "../src/core/block";
import type { DAGDef } from "../src/core/block";

function dagWithGate(check: Record<string, unknown>): DAGDef {
  return {
    name: "gate-test",
    blocks: [
      {
        id: "b1",
        name: "B1",
        inputs: { x: { type: "string", required: false } },
        outputs: { out: { type: "string", required: false } },
        agent: { role: "worker" },
        pre_gates: [{ name: "g", check: check as any, error: "gate failed" }],
        post_gates: [],
        retry: { max_attempts: 0, backoff: "none", delay_ms: 0 },
      },
    ],
    edges: [],
    entrypoints: ["b1"],
    terminals: ["b1"],
  };
}

describe("gate types: cost/latency", () => {
  it("parses and enforces cost gate", () => {
    const engine = createBlockEngine();
    const dag = engine.parseDAG(dagWithGate({ type: "cost", max: 10 }) as unknown as Record<string, unknown>);
    const run = engine.createRun(dag, { __cost: 5 });
    const results = engine.evaluatePreGates(dag.blocks[0], run.context);
    expect(results[0].passed).toBe(true);

    const run2 = engine.createRun(dag, { __cost: 11 });
    const results2 = engine.evaluatePreGates(dag.blocks[0], run2.context);
    expect(results2[0].passed).toBe(false);
  });

  it("parses and enforces latency gate", () => {
    const engine = createBlockEngine();
    const dag = engine.parseDAG(dagWithGate({ type: "latency", max_ms: 100 }) as unknown as Record<string, unknown>);
    const run = engine.createRun(dag, { __latency_ms: 88 });
    const results = engine.evaluatePreGates(dag.blocks[0], run.context);
    expect(results[0].passed).toBe(true);

    const run2 = engine.createRun(dag, { __latency_ms: 120 });
    const results2 = engine.evaluatePreGates(dag.blocks[0], run2.context);
    expect(results2[0].passed).toBe(false);
  });
});
