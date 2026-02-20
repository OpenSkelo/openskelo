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

  it("fails when per-block token budget is exceeded", async () => {
    const provider = makeProvider(() => ({ success: true, output: JSON.stringify({ game_spec: { ok: true }, dev_plan: "ok" }), tokensUsed: 200 }));
    const failures: Array<{ err: string; code?: string }> = [];

    const ex = createDAGExecutor({
      providers: { local: provider },
      agents,
      budget: { maxTokensPerBlock: 100 },
      onBlockFail: (_r, _b, err, code) => failures.push({ err, code }),
    });

    const { run } = await ex.execute(baseDag, { prompt: "x" });
    expect(run.status).toBe("failed");
    expect(failures[0]?.code).toBe("BUDGET_EXCEEDED");
    expect(failures[0]?.err).toContain("Token budget exceeded for block");
  });

  it("records stuck diagnostics when run cannot make progress", async () => {
    const stuckDag: DAGDef = {
      name: "stuck",
      blocks: [
        {
          id: "build",
          name: "Build",
          inputs: { game_spec: { type: "json", required: true } },
          outputs: { artifact_html: { type: "artifact", required: true } },
          agent: { role: "worker" },
          pre_gates: [],
          post_gates: [],
          retry: { max_attempts: 0, backoff: "none", delay_ms: 0 },
        },
      ],
      edges: [],
      entrypoints: ["build"],
      terminals: ["build"],
    };

    const provider = makeProvider(() => ({ success: true, output: JSON.stringify({ artifact_html: "<html></html>" }) }));
    const ex = createDAGExecutor({ providers: { local: provider }, agents });
    const { run } = await ex.execute(stuckDag, {});

    expect(run.status).toBe("failed");
    expect(run.context.__failure_code).toBe("RUN_STUCK");
    const diag = run.context.__stuck_diagnostics as { blocked_count: number; blocked: Array<{ block_id: string; missing_required_inputs: string[] }> };
    expect(diag.blocked_count).toBeGreaterThan(0);
    expect(diag.blocked[0]?.block_id).toBe("build");
    expect(diag.blocked[0]?.missing_required_inputs).toContain("game_spec");
  });

  it("supports pre-gate composition mode any", async () => {
    const dagAny: DAGDef = {
      ...baseDag,
      blocks: [
        {
          ...baseDag.blocks[0],
          gate_composition: { pre: "any" },
          pre_gates: [
            { name: "has_prompt", check: { type: "port_not_empty", port: "prompt" }, error: "missing prompt" },
            { name: "too_long", check: { type: "port_min_length", port: "prompt", min: 999 }, error: "too short" },
          ],
        },
      ],
    };

    const provider = makeProvider(() => ({ success: true, output: JSON.stringify({ game_spec: { ok: true }, dev_plan: "ok" }) }));
    const ex = createDAGExecutor({ providers: { local: provider }, agents });
    const { run } = await ex.execute(dagAny, { prompt: "ship" });
    expect(run.status).toBe("completed");
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

  it("does not silently map raw output to first port for multi-output blocks", async () => {
    const multiDag: DAGDef = {
      name: "multi-port-no-fallback",
      blocks: [
        {
          id: "writer",
          name: "Writer",
          inputs: { prompt: { type: "string", required: true } },
          outputs: {
            result: { type: "string", required: true },
            metadata: { type: "json", required: false },
          },
          agent: { role: "worker" },
          pre_gates: [],
          post_gates: [],
          retry: { max_attempts: 0, backoff: "none", delay_ms: 0 },
        },
      ],
      edges: [],
      entrypoints: ["writer"],
      terminals: ["writer"],
    };

    const provider = makeProvider(() => ({ success: true, output: "plain text, not json" }));
    const failures: Array<{ err: string; code?: string }> = [];

    const ex = createDAGExecutor({
      providers: { local: provider },
      agents,
      onBlockFail: (_r, _b, err, code) => failures.push({ err, code }),
    });

    const { run } = await ex.execute(multiDag, { prompt: "x" });
    expect(run.status).toBe("failed");
    expect(failures[0]?.code).toBe("OUTPUT_CONTRACT_FAILED");
    expect(failures[0]?.err).toContain("missing required output 'result'");
  });

  it("fails loudly on ambiguous agent routing", async () => {
    const ambiguousAgents = {
      worker_a: { role: "worker", capabilities: ["coding"], provider: "local", model: "test-model" },
      worker_b: { role: "worker", capabilities: ["coding"], provider: "local", model: "test-model" },
    };

    const provider = makeProvider(() => ({ success: true, output: JSON.stringify({ game_spec: { ok: true }, dev_plan: "ok" }) }));
    const failures: Array<{ err: string; code?: string }> = [];

    const ex = createDAGExecutor({
      providers: { local: provider },
      agents: ambiguousAgents,
      onBlockFail: (_r, _b, err, code) => failures.push({ err, code }),
    });

    const { run } = await ex.execute(baseDag, { prompt: "x" });
    expect(run.status).toBe("failed");
    expect(failures[0]?.code).toBe("AGENT_ROUTE_AMBIGUOUS");
    expect(failures[0]?.err).toContain("Ambiguous routing");
  });

  it("executes deterministic block without agent ref even when multiple agents exist", async () => {
    const deterministicDag: DAGDef = {
      name: "det-no-agent",
      blocks: [
        {
          id: "copy",
          name: "Copy",
          mode: "deterministic",
          agent: {},
          deterministic: {
            handler: "builtin:transform",
            config: { map: { out: "input" } },
          },
          inputs: { input: { type: "string", required: true } },
          outputs: { out: { type: "string", required: true } },
          pre_gates: [],
          post_gates: [],
          retry: { max_attempts: 0, backoff: "none", delay_ms: 0 },
        },
      ],
      edges: [],
      entrypoints: ["copy"],
      terminals: ["copy"],
    };

    const manyAgents = {
      manager: { role: "manager", capabilities: ["planning"], provider: "local", model: "test-model" },
      worker: { role: "worker", capabilities: ["coding"], provider: "local", model: "test-model" },
      reviewer: { role: "reviewer", capabilities: ["qa"], provider: "local", model: "test-model" },
    };

    const provider = makeProvider(() => ({ success: true, output: "unused" }));
    const ex = createDAGExecutor({ providers: { local: provider }, agents: manyAgents });

    const { run } = await ex.execute(deterministicDag, { input: "hello" });
    expect(run.status).toBe("completed");
    expect(run.blocks.copy.outputs.out).toBe("hello");
  });
});
