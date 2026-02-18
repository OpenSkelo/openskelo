import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parse as parseYaml } from "yaml";
import { createBlockEngine } from "../src/core/block.js";
import type { DAGDef, DAGRun } from "../src/core/block.js";

const engine = createBlockEngine();

function loadExample(name: string): Record<string, unknown> {
  const path = resolve(__dirname, "../examples", name);
  return parseYaml(readFileSync(path, "utf-8"));
}

describe("Block Engine — parseDAG", () => {
  it("parses coding pipeline", () => {
    const dag = engine.parseDAG(loadExample("coding-pipeline.yaml"));
    expect(dag.name).toBe("coding-pipeline");
    expect(dag.blocks).toHaveLength(5);
    expect(dag.edges).toHaveLength(9);
    expect(dag.entrypoints).toEqual(["plan"]);
    expect(dag.terminals).toEqual(["deploy"]);
  });

  it("parses research pipeline", () => {
    const dag = engine.parseDAG(loadExample("research-pipeline.yaml"));
    expect(dag.name).toBe("research-pipeline");
    expect(dag.blocks).toHaveLength(4);
    expect(dag.entrypoints).toEqual(["gather"]);
    expect(dag.terminals).toEqual(["fact-check"]);
  });

  it("parses content pipeline with parallel branches", () => {
    const dag = engine.parseDAG(loadExample("content-pipeline.yaml"));
    expect(dag.name).toBe("content-pipeline");
    expect(dag.blocks).toHaveLength(4);
    // outline has no incoming edges → entrypoint
    expect(dag.entrypoints).toEqual(["outline"]);
    // edit has no outgoing edges → terminal
    expect(dag.terminals).toEqual(["edit"]);
  });

  it("detects cycles", () => {
    expect(() =>
      engine.parseDAG({
        name: "cyclic",
        blocks: [
          { id: "a", inputs: { x: "string" }, outputs: { y: "string" }, agent: {} },
          { id: "b", inputs: { x: "string" }, outputs: { y: "string" }, agent: {} },
        ],
        edges: [
          { from: "a", output: "y", to: "b", input: "x" },
          { from: "b", output: "y", to: "a", input: "x" },
        ],
      })
    ).toThrow(/cycle/i);
  });

  it("validates edge references", () => {
    expect(() =>
      engine.parseDAG({
        name: "bad-edge",
        blocks: [{ id: "a", inputs: { x: "string" }, outputs: { y: "string" }, agent: {} }],
        edges: [{ from: "a", output: "y", to: "nonexistent", input: "x" }],
      })
    ).toThrow(/unknown block/i);
  });

  it("validates port references in edges", () => {
    expect(() =>
      engine.parseDAG({
        name: "bad-port",
        blocks: [
          { id: "a", inputs: {}, outputs: { y: "string" }, agent: {} },
          { id: "b", inputs: { x: "string" }, outputs: {}, agent: {} },
        ],
        edges: [{ from: "a", output: "nonexistent", to: "b", input: "x" }],
      })
    ).toThrow(/unknown output port/i);
  });

  it("rejects invalid gate check type at parse time", () => {
    expect(() =>
      engine.parseDAG({
        name: "bad-gate-type",
        blocks: [{
          id: "a",
          inputs: { x: "string" },
          outputs: { y: "string" },
          pre_gates: [{ name: "g1", check: { type: "unknown_gate" }, error: "nope" }],
          agent: {},
        }],
        edges: [],
      })
    ).toThrow(/unknown gate check type/i);
  });

  it("rejects invalid gate regex at parse time", () => {
    expect(() =>
      engine.parseDAG({
        name: "bad-gate-regex",
        blocks: [{
          id: "a",
          inputs: { x: "string" },
          outputs: { y: "string" },
          pre_gates: [{ name: "g1", check: { type: "port_matches", port: "x", pattern: "(" }, error: "nope" }],
          agent: {},
        }],
        edges: [],
      })
    ).toThrow(/valid regex/i);
  });

  it("rejects invalid port type at parse time", () => {
    expect(() =>
      engine.parseDAG({
        name: "bad-port-type",
        blocks: [{
          id: "a",
          inputs: { x: "wat" },
          outputs: { y: "string" },
          agent: {},
        }],
        edges: [],
      })
    ).toThrow(/invalid port type/i);
  });
});

describe("Block Engine — createRun", () => {
  it("creates a run with all blocks in pending state", () => {
    const dag = engine.parseDAG(loadExample("coding-pipeline.yaml"));
    const run = engine.createRun(dag, { prompt: "Build a login page" });

    expect(run.id).toMatch(/^run_/);
    expect(run.status).toBe("pending");
    expect(Object.keys(run.blocks)).toHaveLength(5);
    expect(run.context.prompt).toBe("Build a login page");

    for (const instance of Object.values(run.blocks)) {
      expect(instance.status).toBe("pending");
    }
  });
});

describe("Block Engine — resolveReady", () => {
  it("identifies entrypoints as ready when context provides inputs", () => {
    const dag = engine.parseDAG(loadExample("coding-pipeline.yaml"));
    const run = engine.createRun(dag, { prompt: "Build a login page" });

    const ready = engine.resolveReady(dag, run);
    expect(ready).toEqual(["plan"]);
  });

  it("marks downstream blocks as not ready when upstream is pending", () => {
    const dag = engine.parseDAG(loadExample("coding-pipeline.yaml"));
    const run = engine.createRun(dag, { prompt: "Build a login page" });

    const ready = engine.resolveReady(dag, run);
    expect(ready).not.toContain("build");
    expect(ready).not.toContain("test");
    expect(ready).not.toContain("review");
    expect(ready).not.toContain("deploy");
  });

  it("resolves parallel blocks when shared upstream completes", () => {
    const dag = engine.parseDAG(loadExample("content-pipeline.yaml"));
    const run = engine.createRun(dag, { topic: "AI agents" });

    // Initially only outline is ready
    expect(engine.resolveReady(dag, run)).toEqual(["outline"]);

    // Simulate outline completion
    engine.startBlock(run, "outline", { topic: "AI agents" });
    engine.completeBlock(run, "outline",
      { outline: [{ section: "intro" }], tone: "professional" },
      mockExecution()
    );

    // Now both draft AND images should be ready (parallel)
    const ready = engine.resolveReady(dag, run);
    expect(ready).toContain("draft");
    expect(ready).toContain("images");
    expect(ready).not.toContain("edit");
  });
});

describe("Block Engine — wireInputs", () => {
  it("wires upstream outputs to downstream inputs", () => {
    const dag = engine.parseDAG(loadExample("coding-pipeline.yaml"));
    const run = engine.createRun(dag, { prompt: "Build a login page" });

    // Complete plan block
    engine.startBlock(run, "plan", { prompt: "Build a login page" });
    engine.completeBlock(run, "plan",
      { plan: "Step 1: create form", files_to_modify: ["login.tsx"] },
      mockExecution()
    );

    const buildInputs = engine.wireInputs(dag, run, "build");
    expect(buildInputs.plan).toBe("Step 1: create form");
    expect(buildInputs.files_to_modify).toEqual(["login.tsx"]);
  });

  it("falls back to context when no edge exists", () => {
    const dag = engine.parseDAG(loadExample("research-pipeline.yaml"));
    const run = engine.createRun(dag, { query: "What is quantum computing?" });

    const gatherInputs = engine.wireInputs(dag, run, "gather");
    expect(gatherInputs.query).toBe("What is quantum computing?");
    // max_sources should use default
    expect(gatherInputs.max_sources).toBe(10);
  });
});

describe("Block Engine — pre/post gates", () => {
  it("pre-gate fails on empty required port", () => {
    const dag = engine.parseDAG(loadExample("coding-pipeline.yaml"));
    const buildDef = dag.blocks.find(b => b.id === "build")!;

    const results = engine.evaluatePreGates(buildDef, { plan: "", files_to_modify: [] });
    expect(results.some(r => !r.passed)).toBe(true);
  });

  it("pre-gate passes with valid inputs", () => {
    const dag = engine.parseDAG(loadExample("coding-pipeline.yaml"));
    const buildDef = dag.blocks.find(b => b.id === "build")!;

    const results = engine.evaluatePreGates(buildDef, { plan: "Do the thing", files_to_modify: ["a.ts"] });
    expect(results.every(r => r.passed)).toBe(true);
  });
});

describe("Block Engine — executionOrder", () => {
  it("returns valid topological order for coding pipeline", () => {
    const dag = engine.parseDAG(loadExample("coding-pipeline.yaml"));
    const order = engine.executionOrder(dag);

    expect(order.indexOf("plan")).toBeLessThan(order.indexOf("build"));
    expect(order.indexOf("build")).toBeLessThan(order.indexOf("test"));
    expect(order.indexOf("build")).toBeLessThan(order.indexOf("review"));
    expect(order.indexOf("review")).toBeLessThan(order.indexOf("deploy"));
  });

  it("allows parallel blocks in content pipeline", () => {
    const dag = engine.parseDAG(loadExample("content-pipeline.yaml"));
    const order = engine.executionOrder(dag);

    expect(order.indexOf("outline")).toBeLessThan(order.indexOf("draft"));
    expect(order.indexOf("outline")).toBeLessThan(order.indexOf("images"));
    // draft and images are independent — both just after outline
    expect(order.indexOf("draft")).toBeLessThan(order.indexOf("edit"));
    expect(order.indexOf("images")).toBeLessThan(order.indexOf("edit"));
  });
});

describe("Block Engine — shell gate security", () => {
  it("rejects shell gates by default", () => {
    delete process.env.OPENSKELO_ALLOW_SHELL_GATES;
    const dag = engine.parseDAG({
      name: "shell-default-deny",
      blocks: [{
        id: "a",
        inputs: { code: "string" },
        outputs: { out: "string" },
        pre_gates: [{
          name: "shell-check",
          check: { type: "shell", command: 'node -e "process.exit(0)"' },
          error: "shell failed",
        }],
        post_gates: [],
        agent: {},
        retry: { max_attempts: 0, backoff: "none", delay_ms: 0 },
      }],
      edges: [],
    });
    const res = engine.evaluatePreGates(dag.blocks[0]!, { code: "ok" });
    expect(res[0]?.passed).toBe(false);
    expect(res[0]?.reason).toMatch(/shell gates disabled/i);
    expect(res[0]?.audit?.status).toBe("blocked");
  });

  it("allows shell gates with explicit opt-in", () => {
    process.env.OPENSKELO_ALLOW_SHELL_GATES = "true";
    const dag = engine.parseDAG({
      name: "shell-opt-in",
      blocks: [{
        id: "a",
        inputs: { code: "string" },
        outputs: { out: "string" },
        pre_gates: [{
          name: "shell-check",
          check: { type: "shell", command: 'node -e "process.exit(0)"' },
          error: "shell failed",
        }],
        post_gates: [],
        agent: {},
        retry: { max_attempts: 0, backoff: "none", delay_ms: 0 },
      }],
      edges: [],
    });
    const res = engine.evaluatePreGates(dag.blocks[0]!, { code: "ok" });
    expect(res[0]?.passed).toBe(true);
    expect(res[0]?.audit?.status).toBe("passed");
  });

  it("enforces shell gate timeout", () => {
    process.env.OPENSKELO_ALLOW_SHELL_GATES = "true";
    process.env.OPENSKELO_SHELL_GATE_TIMEOUT_MS = "20";
    const dag = engine.parseDAG({
      name: "shell-timeout",
      blocks: [{
        id: "a",
        inputs: { code: "string" },
        outputs: { out: "string" },
        pre_gates: [{
          name: "shell-check",
          check: { type: "shell", command: 'node -e "setTimeout(() => {}, 200)"' },
          error: "shell failed",
        }],
        post_gates: [],
        agent: {},
        retry: { max_attempts: 0, backoff: "none", delay_ms: 0 },
      }],
      edges: [],
    });
    const res = engine.evaluatePreGates(dag.blocks[0]!, { code: "ok" });
    expect(res[0]?.passed).toBe(false);
    expect(res[0]?.audit?.status).toBe("failed");
    expect((res[0]?.audit?.duration_ms as number) >= 0).toBe(true);
    delete process.env.OPENSKELO_SHELL_GATE_TIMEOUT_MS;
  });
});

describe("Block Engine — expression security", () => {
  it("blocks access to process from expr gate", () => {
    const dag = engine.parseDAG({
      name: "expr-security",
      blocks: [{
        id: "a",
        inputs: { code: "string" },
        outputs: { out: "string" },
        pre_gates: [{
          name: "safe-expr",
          check: { type: "expr", expression: "process.env.OPENAI_API_KEY" },
          error: "bad",
        }],
        post_gates: [],
        agent: {},
        retry: { max_attempts: 0, backoff: "none", delay_ms: 0 },
      }],
      edges: [],
    });
    const block = dag.blocks[0]!;
    const res = engine.evaluatePreGates(block, { code: "hello" });
    expect(res[0]?.passed).toBe(false);
    expect(res[0]?.reason).toMatch(/Expression error/);
  });

  it("allows safe expr gates", () => {
    const dag = engine.parseDAG({
      name: "expr-safe",
      blocks: [{
        id: "a",
        inputs: { code: "string" },
        outputs: { out: "string" },
        pre_gates: [{
          name: "safe-expr",
          check: { type: "expr", expression: "inputs.code.length > 3" },
          error: "too short",
        }],
        post_gates: [],
        agent: {},
        retry: { max_attempts: 0, backoff: "none", delay_ms: 0 },
      }],
      edges: [],
    });
    const block = dag.blocks[0]!;
    const pass = engine.evaluatePreGates(block, { code: "hello" });
    expect(pass[0]?.passed).toBe(true);
    const fail = engine.evaluatePreGates(block, { code: "no" });
    expect(fail[0]?.passed).toBe(false);
  });

  it("blocks unsafe transform and falls back to original value", () => {
    const dag = engine.parseDAG({
      name: "transform-security",
      blocks: [
        { id: "a", inputs: {}, outputs: { out: "string" }, pre_gates: [], post_gates: [], agent: {}, retry: { max_attempts: 0, backoff: "none", delay_ms: 0 } },
        { id: "b", inputs: { in: "string" }, outputs: { out2: "string" }, pre_gates: [], post_gates: [], agent: {}, retry: { max_attempts: 0, backoff: "none", delay_ms: 0 } },
      ],
      edges: [{ from: "a", output: "out", to: "b", input: "in", transform: "process.exit(1)" }],
    });
    const run = engine.createRun(dag, {});
    engine.startBlock(run, "a", {});
    engine.completeBlock(run, "a", { out: "safe" }, mockExecution());
    const inputs = engine.wireInputs(dag, run, "b");
    expect(inputs.in).toBe("safe");
  });
});

describe("Block Engine — hashBlockDef", () => {
  it("produces deterministic hashes", () => {
    const dag = engine.parseDAG(loadExample("coding-pipeline.yaml"));
    const h1 = engine.hashBlockDef(dag.blocks[0]);
    const h2 = engine.hashBlockDef(dag.blocks[0]);
    expect(h1).toBe(h2);
    expect(h1).toHaveLength(16);
  });

  it("different blocks produce different hashes", () => {
    const dag = engine.parseDAG(loadExample("coding-pipeline.yaml"));
    const hashes = dag.blocks.map(b => engine.hashBlockDef(b));
    const unique = new Set(hashes);
    expect(unique.size).toBe(hashes.length);
  });
});

describe("Block Engine — DAG completion", () => {
  it("detects completion when all terminals are done", () => {
    const dag = engine.parseDAG(loadExample("coding-pipeline.yaml"));
    const run = engine.createRun(dag, {});

    expect(engine.isComplete(dag, run)).toBe(false);

    // Complete only the terminal (deploy)
    run.blocks["deploy"].status = "completed";
    expect(engine.isComplete(dag, run)).toBe(true);
  });
});

// ── Helpers ──

function mockExecution() {
  return {
    agent_id: "test-agent",
    provider: "test",
    model: "test-model",
    raw_output: "test output",
    tokens_in: 100,
    tokens_out: 50,
    duration_ms: 1000,
  };
}
