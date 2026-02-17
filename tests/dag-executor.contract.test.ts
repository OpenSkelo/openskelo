import { describe, it, expect } from "vitest";
import { createDAGExecutor } from "../src/core/dag-executor";
import type { DAGDef } from "../src/core/block";
import type { ProviderAdapter, DispatchRequest, DispatchResult } from "../src/types";

const baseDag: DAGDef = {
  name: "contract-test",
  blocks: [
    {
      id: "spec",
      name: "Spec",
      inputs: { prompt: { type: "string", required: true } },
      outputs: {
        game_spec: { type: "json", required: true },
        dev_plan: { type: "string", required: true },
      },
      agent: { role: "worker" },
      pre_gates: [],
      post_gates: [],
      retry: { max_attempts: 0, backoff: "none", delay_ms: 0 },
    },
  ],
  edges: [],
  entrypoints: ["spec"],
  terminals: ["spec"],
};

function makeProvider(fn: (req: DispatchRequest, n: number) => DispatchResult): ProviderAdapter {
  let n = 0;
  return {
    name: "test",
    type: "test",
    async dispatch(req: DispatchRequest) {
      n++;
      return fn(req, n);
    },
  };
}

const agents = {
  worker: { role: "worker", capabilities: ["coding"], provider: "local", model: "test-model" },
};

describe("DAG executor output contract", () => {
  it("fails when required outputs are missing", async () => {
    const provider = makeProvider(() => ({ success: true, output: JSON.stringify({ game_spec: { ok: true } }) }));
    const failures: Array<{ err: string; code?: string }> = [];

    const ex = createDAGExecutor({
      providers: { local: provider },
      agents,
      onBlockFail: (_r, _b, err, code) => failures.push({ err, code }),
    });

    const { run } = await ex.execute(baseDag, { prompt: "x" });
    expect(run.status).toBe("failed");
    expect(failures[0].code).toBe("OUTPUT_CONTRACT_FAILED");
    expect(failures[0].err).toContain("missing required output 'dev_plan'");
  });

  it("fails when output type is wrong", async () => {
    const provider = makeProvider(() => ({ success: true, output: JSON.stringify({ game_spec: "not json", dev_plan: "ok" }) }));
    const failures: Array<{ err: string; code?: string }> = [];

    const ex = createDAGExecutor({
      providers: { local: provider },
      agents,
      onBlockFail: (_r, _b, err, code) => failures.push({ err, code }),
    });

    const { run } = await ex.execute(baseDag, { prompt: "x" });
    expect(run.status).toBe("failed");
    expect(failures[0].code).toBe("OUTPUT_CONTRACT_FAILED");
    expect(failures[0].err).toContain("expected type 'json'");
  });

  it("repairs once and succeeds when second response meets contract", async () => {
    const provider = makeProvider((_req, n) => {
      if (n === 1) return { success: true, output: JSON.stringify({ game_spec: { ok: true } }) };
      return { success: true, output: JSON.stringify({ game_spec: { ok: true }, dev_plan: "ship it" }) };
    });

    const ex = createDAGExecutor({ providers: { local: provider }, agents });
    const { run } = await ex.execute(baseDag, { prompt: "x" });

    expect(run.status).toBe("completed");
    expect(run.blocks.spec.outputs.dev_plan).toBe("ship it");
  });
});
