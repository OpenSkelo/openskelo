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

const chainDag: DAGDef = {
  name: "contract-chain-test",
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
      contract_repair_attempts: 2,
    },
    {
      id: "build",
      name: "Build",
      inputs: {
        game_spec: { type: "json", required: true },
        dev_plan: { type: "string", required: true },
      },
      outputs: {
        artifact_html: { type: "artifact", required: true },
        branch: { type: "string", required: true },
        changelog: { type: "string", required: true },
      },
      agent: { role: "worker" },
      pre_gates: [],
      post_gates: [],
      retry: { max_attempts: 0, backoff: "none", delay_ms: 0 },
    },
  ],
  edges: [
    { from: "spec", output: "game_spec", to: "build", input: "game_spec" },
    { from: "spec", output: "dev_plan", to: "build", input: "dev_plan" },
  ],
  entrypoints: ["spec"],
  terminals: ["build"],
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

  it("fails with timeout when block dispatch exceeds timeout_ms", async () => {
    const timeoutDag: DAGDef = {
      ...baseDag,
      blocks: baseDag.blocks.map((b) => ({ ...b, timeout_ms: 30 })),
    };

    const failures: Array<{ err: string; code?: string }> = [];
    const provider: ProviderAdapter = {
      name: "slow",
      type: "slow",
      async dispatch(req: DispatchRequest) {
        await new Promise<void>((resolve, reject) => {
          const t = setTimeout(resolve, 200);
          req.abortSignal?.addEventListener("abort", () => {
            clearTimeout(t);
            reject(new Error(String(req.abortSignal?.reason ?? "aborted")));
          }, { once: true });
        });
        return { success: true, output: JSON.stringify({ game_spec: { ok: true }, dev_plan: "late" }) };
      },
    };

    const ex = createDAGExecutor({
      providers: { local: provider },
      agents,
      onBlockFail: (_r, _b, err, code) => failures.push({ err, code }),
    });

    const { run } = await ex.execute(timeoutDag, { prompt: "x" });
    expect(run.status).toBe("failed");
    expect(failures[0]?.code).toBe("DISPATCH_TIMEOUT");
    expect(failures[0]?.err.toLowerCase()).toContain("timed out");
  });

  it("continues from spec to build across repeated runs", async () => {
    for (let i = 0; i < 5; i++) {
      let call = 0;
      const provider: ProviderAdapter = {
        name: "test",
        type: "test",
        async dispatch(req: DispatchRequest) {
          call++;
          if (req.title === "Spec") {
            if (call % 2 === 1) return { success: true, output: JSON.stringify({ game_spec: { ok: true } }) };
            return { success: true, output: JSON.stringify({ game_spec: { ok: true }, dev_plan: "build now" }) };
          }
          return {
            success: true,
            output: JSON.stringify({ artifact_html: "<html></html>", branch: "feature/test", changelog: "ok" }),
          };
        },
      };

      const ex = createDAGExecutor({ providers: { local: provider }, agents });
      const { run } = await ex.execute(chainDag, { prompt: "doom clone" });
      expect(run.status).toBe("completed");
      expect(run.blocks.spec.status).toBe("completed");
      expect(run.blocks.build.status).toBe("completed");
      expect(run.blocks.build.outputs.artifact_html).toContain("<html>");
    }
  });
});
