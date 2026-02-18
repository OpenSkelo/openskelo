import { describe, it, expect } from "vitest";
import { createDAGExecutor } from "../src/core/dag-executor";
import type { DAGDef } from "../src/core/block";
import type { ProviderAdapter, DispatchRequest } from "../src/types";

function makeLinearDag(n: number): DAGDef {
  const blocks = Array.from({ length: n }, (_, i) => ({
    id: `b${i + 1}`,
    name: `Block ${i + 1}`,
    inputs: i === 0 ? { seed: { type: "string", required: true } } : { prev: { type: "string", required: true } },
    outputs: { out: { type: "string", required: true } },
    agent: { role: "worker" },
    pre_gates: [],
    post_gates: [],
    retry: { max_attempts: 0, backoff: "none", delay_ms: 0 },
  }));

  const edges = Array.from({ length: n - 1 }, (_, i) => ({
    from: `b${i + 1}`,
    output: "out",
    to: `b${i + 2}`,
    input: "prev",
  }));

  return {
    name: `linear-${n}`,
    blocks,
    edges,
    entrypoints: ["b1"],
    terminals: [`b${n}`],
  };
}

describe("performance stress baseline", () => {
  it("completes a 100-block linear DAG", async () => {
    const dag = makeLinearDag(100);
    const provider: ProviderAdapter = {
      name: "fast-mock",
      type: "mock",
      async dispatch(req: DispatchRequest) {
        const marker = String(req.inputs?.prev ?? req.inputs?.seed ?? "x");
        return { success: true, output: JSON.stringify({ out: `${marker}-ok` }), tokensUsed: 1 };
      },
    };

    const ex = createDAGExecutor({
      providers: { local: provider },
      agents: { worker: { role: "worker", capabilities: ["all"], provider: "local", model: "mock" } },
      maxParallel: 8,
    });

    const t0 = Date.now();
    const { run } = await ex.execute(dag, { seed: "start" });
    const elapsedMs = Date.now() - t0;

    expect(run.status).toBe("completed");
    expect(String(run.blocks.b100.outputs.out)).toContain("ok");

    // Baseline guardrail: should complete comfortably under 2s on local CI/dev.
    expect(elapsedMs).toBeLessThan(2000);
  });
});
