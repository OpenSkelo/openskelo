import { describe, it, expect } from "vitest";
import { createBlockEngine } from "../src/core/block";
import type { DAGDef } from "../src/core/block";

function dagWithHttp(expectStatus = 200): DAGDef {
  return {
    name: "http-gate",
    blocks: [
      {
        id: "b1",
        name: "B1",
        inputs: { x: { type: "string", required: false } },
        outputs: { out: { type: "string", required: false } },
        agent: { role: "worker" },
        pre_gates: [
          {
            name: "http-check",
            check: { type: "http", url: "mock://status/200", method: "GET", expect_status: expectStatus },
            error: "http gate failed",
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

describe("gate type: http", () => {
  it("passes when status matches expected", () => {
    const engine = createBlockEngine();
    const dag = engine.parseDAG(dagWithHttp(200) as unknown as Record<string, unknown>);
    const results = engine.evaluatePreGates(dag.blocks[0], {});
    expect(results[0].passed).toBe(true);
  });

  it("fails when status does not match expected", () => {
    const engine = createBlockEngine();
    const dag = engine.parseDAG(dagWithHttp(204) as unknown as Record<string, unknown>);
    const results = engine.evaluatePreGates(dag.blocks[0], {});
    expect(results[0].passed).toBe(false);
    expect(String(results[0].reason ?? "")).toContain("expected status");
  });
});
