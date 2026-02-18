import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createDB, closeDB } from "../src/core/db";
import { createAPI } from "../src/server/api";
import { createDAGAPI } from "../src/server/dag-api";
import type { SkeloConfig } from "../src/types";

const cleanups: Array<() => void> = [];
afterEach(() => {
  while (cleanups.length) cleanups.pop()?.();
});

function withFetchMock(mock: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>) {
  const prev = globalThis.fetch;
  globalThis.fetch = mock as typeof fetch;
  return () => {
    globalThis.fetch = prev;
  };
}

function createTestConfig(): SkeloConfig {
  return {
    name: "OpenSkelo DAG Test",
    storage: "sqlite",
    providers: [{ name: "local", type: "http" }],
    dashboard: { enabled: false, port: 4040 },
    agents: {
      manager: { role: "manager", capabilities: ["planning"], provider: "local", model: "openai-codex/gpt-5.3-codex", max_concurrent: 1 },
      worker: { role: "worker", capabilities: ["coding", "devops"], provider: "local", model: "openai-codex/gpt-5.3-codex", max_concurrent: 1 },
      reviewer: { role: "reviewer", capabilities: ["qa"], provider: "local", model: "openai-codex/gpt-5.3-codex", max_concurrent: 1 },
    },
    pipelines: {
      core: {
        stages: [
          { name: "PENDING", transitions: ["IN_PROGRESS"] },
          { name: "IN_PROGRESS", transitions: ["REVIEW"] },
          { name: "REVIEW", transitions: ["DONE"] },
          { name: "DONE", transitions: [] },
        ],
      },
    },
    gates: [],
  };
}

const __dirname = dirname(fileURLToPath(import.meta.url));

function setupDagTestApp(examplesDirOverride?: string) {
  return setupDagTestAppWithConfig(createTestConfig(), examplesDirOverride);
}

function setupDagTestAppWithConfig(config: SkeloConfig, examplesDirOverride?: string) {
  const workdir = mkdtempSync(join(tmpdir(), "openskelo-dag-test-"));
  createDB(workdir);

  const app = createAPI({ config });

  const examplesDir = examplesDirOverride ?? resolve(__dirname, "../examples");
  const dagAPI = createDAGAPI(config, { examplesDir });
  app.route("/", dagAPI);

  return {
    app,
    cleanup: () => closeDB(),
  };
}

async function waitForRunStatus(app: { request: (path: string, init?: RequestInit) => Promise<Response> }, runId: string, wanted: string[], timeoutMs = 12000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const res = await app.request(`/api/dag/runs/${runId}`);
    if (res.status === 200) {
      const body = (await res.json()) as { run: { status: string; context?: Record<string, unknown> }; approval?: Record<string, unknown> | null };
      if (wanted.includes(body.run.status)) return body;
    }
    await new Promise((r) => setTimeout(r, 120));
  }
  throw new Error(`timeout waiting for run ${runId} status in [${wanted.join(",")}]`);
}

describe("DAG API integration", () => {
  it("exposes safety + examples endpoints", async () => {
    const ctx = setupDagTestApp();
    cleanups.push(ctx.cleanup);

    const safetyRes = await ctx.app.request("/api/dag/safety");
    expect(safetyRes.status).toBe(200);
    const safety = (await safetyRes.json()) as { safety: Record<string, number> };
    expect(safety.safety.maxConcurrentRuns).toBeGreaterThan(0);
    expect(safety.safety.maxRunDurationMs).toBeGreaterThan(0);

    const examplesRes = await ctx.app.request("/api/dag/examples");
    expect(examplesRes.status).toBe(200);
    const examples = (await examplesRes.json()) as { examples: Array<{ file: string }> };
    expect(examples.examples.length).toBeGreaterThan(0);
  });

  it("rejects unknown provider override on run start", async () => {
    const ctx = setupDagTestApp();
    cleanups.push(ctx.cleanup);

    const res = await ctx.app.request("/api/dag/run", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ example: "coding-pipeline.yaml", provider: "does-not-exist", context: { prompt: "x" } }),
    });

    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toContain("Unknown provider");
  });

  it("enforces max request size on dag endpoints", async () => {
    const prev = process.env.OPENSKELO_MAX_REQUEST_BYTES;
    process.env.OPENSKELO_MAX_REQUEST_BYTES = "100";
    const ctx = setupDagTestApp();
    cleanups.push(() => {
      if (prev === undefined) delete process.env.OPENSKELO_MAX_REQUEST_BYTES;
      else process.env.OPENSKELO_MAX_REQUEST_BYTES = prev;
      ctx.cleanup();
    });

    const big = "x".repeat(2000);
    const res = await ctx.app.request("/api/dag/run", {
      method: "POST",
      headers: { "content-type": "application/json", "content-length": String(big.length) },
      body: big,
    });

    expect(res.status).toBe(413);
    const body = (await res.json()) as { error: string };
    expect(body.error).toContain("Request too large");
  });

  it("routes provider override by name/type to the correct adapter endpoints", async () => {
    const examplesDir = mkdtempSync(join(tmpdir(), "openskelo-dag-examples-"));
    mkdirSync(examplesDir, { recursive: true });
    writeFileSync(join(examplesDir, "single-step.yaml"), `name: single-step\nblocks:\n  - id: draft\n    name: Draft\n    inputs:\n      prompt: string\n    outputs: {}\n    agent:\n      specific: manager\n    pre_gates: []\n    post_gates: []\n    retry:\n      max_attempts: 0\n      backoff: none\n      delay_ms: 0\nedges: []\n`);

    const cfg = createTestConfig();
    cfg.providers = [
      { name: "ollamaLocal", type: "ollama", url: "http://fake-ollama:11434" },
      { name: "cloud", type: "http", url: "http://fake-openai/v1", env: "TEST_API_KEY", config: { authHeader: "Authorization" } },
    ];
    cfg.agents.manager.provider = "cloud";

    process.env.TEST_API_KEY = "test-key";

    const fetchCalls: string[] = [];
    const restoreFetch = withFetchMock(async (input) => {
      const url = String(input);
      fetchCalls.push(url);
      if (url.includes("/api/chat")) {
        return new Response(JSON.stringify({ model: "llama3", message: { content: "ok" }, prompt_eval_count: 1, eval_count: 1 }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      if (url.includes("/chat/completions")) {
        return new Response(JSON.stringify({ model: "gpt-4o-mini", choices: [{ message: { content: "ok" } }], usage: { total_tokens: 2 } }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      return new Response("not found", { status: 404 });
    });

    const ctx = setupDagTestAppWithConfig(cfg, examplesDir);
    cleanups.push(() => {
      restoreFetch();
      delete process.env.TEST_API_KEY;
      ctx.cleanup();
    });

    const byType = await ctx.app.request("/api/dag/run", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ example: "single-step.yaml", provider: "ollama", context: { prompt: "x" }, devMode: true }),
    });
    expect(byType.status).toBe(201);

    const byName = await ctx.app.request("/api/dag/run", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ example: "single-step.yaml", provider: "cloud", context: { prompt: "x" }, devMode: true }),
    });
    expect(byName.status).toBe(201);

    const sawOllama = fetchCalls.some((u) => u.includes("fake-ollama") && u.includes("/api/chat"));
    const sawOpenAICompat = fetchCalls.some((u) => u.includes("fake-openai") && u.includes("/chat/completions"));
    expect(sawOllama).toBe(true);
    expect(sawOpenAICompat).toBe(true);
  });

  it("rejects invalid agentMapping targets", async () => {
    const ctx = setupDagTestApp();
    cleanups.push(ctx.cleanup);

    const res = await ctx.app.request("/api/dag/run", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        example: "coding-pipeline.yaml",
        provider: "local",
        devMode: true,
        context: { prompt: "x" },
        agentMapping: { reviewer: "not-a-real-agent" },
      }),
    });

    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toContain("Invalid agentMapping target");
  });

  it("creates run + supports stop and replay/status paths", async () => {
    const examplesDir = mkdtempSync(join(tmpdir(), "openskelo-dag-examples-"));
    mkdirSync(examplesDir, { recursive: true });
    writeFileSync(join(examplesDir, "iter-approval.yaml"), `name: iter-approval\nblocks:\n  - id: draft\n    name: Draft\n    approval:\n      required: true\n      prompt: Approve draft?\n    inputs:\n      prompt: string\n    outputs:\n      artifact_html: artifact\n    agent:\n      specific: manager\n    pre_gates: []\n    post_gates: []\n    retry:\n      max_attempts: 0\n      backoff: none\n      delay_ms: 0\nedges: []\n`);

    const ctx = setupDagTestApp(examplesDir);
    cleanups.push(ctx.cleanup);

    const start = await ctx.app.request("/api/dag/run", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        example: "iter-approval.yaml",
        provider: "local",
        timeoutSeconds: 1,
        devMode: true,
        context: { prompt: "dag integration test" },
      }),
    });

    expect(start.status).toBe(201);
    const created = (await start.json()) as { run_id: string };
    expect(created.run_id).toMatch(/^run_/);

    const getRes = await ctx.app.request(`/api/dag/runs/${created.run_id}`);
    expect(getRes.status).toBe(200);

    const replayRes = await ctx.app.request(`/api/dag/runs/${created.run_id}/replay?since=0`);
    expect(replayRes.status).toBe(200);

    const stopRes = await ctx.app.request(`/api/dag/runs/${created.run_id}/stop`, { method: "POST" });
    expect(stopRes.status).toBe(200);
    const stopped = (await stopRes.json()) as { status: string };
    expect(stopped.status).toBe("cancelled");
  });

  it("supports reject→iterate and marks parent as iterated with child linkage", async () => {
    const examplesDir = mkdtempSync(join(tmpdir(), "openskelo-dag-examples-"));
    mkdirSync(examplesDir, { recursive: true });
    writeFileSync(join(examplesDir, "iter-approval.yaml"), `name: iter-approval\nblocks:\n  - id: draft\n    name: Draft\n    approval:\n      required: true\n      prompt: Approve draft?\n    inputs:\n      prompt: string\n    outputs:\n      artifact_html: artifact\n    agent:\n      specific: manager\n    pre_gates: []\n    post_gates: []\n    retry:\n      max_attempts: 0\n      backoff: none\n      delay_ms: 0\nedges: []\n`);

    const ctx = setupDagTestApp(examplesDir);
    cleanups.push(ctx.cleanup);

    const start = await ctx.app.request("/api/dag/run", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        example: "iter-approval.yaml",
        provider: "local",
        timeoutSeconds: 1,
        devMode: false,
        context: { prompt: "test" },
      }),
    });
    expect(start.status).toBe(201);
    const created = (await start.json()) as { run_id: string };

    const paused = await waitForRunStatus(ctx.app as any, created.run_id, ["paused_approval"], 8000);
    expect(paused.run.status).toBe("paused_approval");
    expect(paused.approval && paused.approval.status).toBe("pending");

    const reject = await ctx.app.request(`/api/dag/runs/${created.run_id}/approvals`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ decision: "reject", iterate: true, restart_mode: "refine", feedback: "iterate again" }),
    });
    expect(reject.status).toBe(200);
    const rejected = (await reject.json()) as { run_status: string; iterated_run_id?: string };
    expect(rejected.run_status).toBe("iterated");
    expect(rejected.iterated_run_id).toMatch(/^run_/);

    const parent = await ctx.app.request(`/api/dag/runs/${created.run_id}`);
    expect(parent.status).toBe(200);
    const parentBody = (await parent.json()) as { run: { status: string; context: Record<string, unknown> } };
    expect(parentBody.run.status).toBe("iterated");
    expect(parentBody.run.context.__latest_iterated_run_id).toBe(rejected.iterated_run_id);

    const child = await ctx.app.request(`/api/dag/runs/${rejected.iterated_run_id}`);
    expect(child.status).toBe(200);
    const childBody = (await child.json()) as { run: { id: string; context: Record<string, unknown> } };
    expect(childBody.run.context.__iteration_parent_run_id).toBe(created.run_id);

    await ctx.app.request("/api/dag/runs/stop-all", { method: "POST" });
  }, 20000);

  it("persists shell gate audit metadata in durable dag events", async () => {
    const examplesDir = mkdtempSync(join(tmpdir(), "openskelo-dag-examples-"));
    mkdirSync(examplesDir, { recursive: true });
    writeFileSync(join(examplesDir, "shell-gate.yaml"), `name: shell-gate\nblocks:\n  - id: draft\n    name: Draft\n    inputs:\n      prompt: string\n    outputs:\n      out: string\n    pre_gates:\n      - name: shell-check\n        check:\n          type: shell\n          command: \"node -e \\\"process.exit(0)\\\"\"\n        error: shell failed\n    post_gates: []\n    agent:\n      specific: manager\n    retry:\n      max_attempts: 0\n      backoff: none\n      delay_ms: 0\nedges: []\n`);

    delete process.env.OPENSKELO_ALLOW_SHELL_GATES;

    const ctx = setupDagTestApp(examplesDir);
    cleanups.push(() => {
      delete process.env.OPENSKELO_ALLOW_SHELL_GATES;
      ctx.cleanup();
    });

    const start = await ctx.app.request("/api/dag/run", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        example: "shell-gate.yaml",
        provider: "local",
        devMode: true,
        context: { prompt: "test" },
      }),
    });
    expect(start.status).toBe(201);
    const created = (await start.json()) as { run_id: string };

    await waitForRunStatus(ctx.app as any, created.run_id, ["failed"], 8000);

    const replayRes = await ctx.app.request(`/api/dag/runs/${created.run_id}/replay?since=0`);
    expect(replayRes.status).toBe(200);
    const replay = (await replayRes.json()) as { events: Array<Record<string, unknown>> };
    const failEvent = replay.events.find((e) => e.type === "block:fail");
    expect(failEvent).toBeTruthy();

    const failData = (failEvent?.data as Record<string, unknown>) ?? {};
    const instance = (failData.instance as Record<string, unknown>) ?? {};
    const preGates = (instance.pre_gate_results as Array<Record<string, unknown>>) ?? [];
    expect(preGates.length).toBeGreaterThan(0);
    const shellGate = preGates[0] ?? {};
    const audit = (shellGate.audit as Record<string, unknown>) ?? {};
    expect(audit.gate_type).toBe("shell");
    expect(audit.status).toBe("blocked");
    expect(typeof audit.command).toBe("string");
  });

  it("returns YAML line/column diagnostics for malformed DAG example", async () => {
    const examplesDir = mkdtempSync(join(tmpdir(), "openskelo-dag-examples-"));
    mkdirSync(examplesDir, { recursive: true });
    writeFileSync(join(examplesDir, "bad.yaml"), `name: bad\nblocks:\n  - id: a\n    inputs: [\n`);

    const ctx = setupDagTestApp(examplesDir);
    cleanups.push(ctx.cleanup);

    const res = await ctx.app.request("/api/dag/run", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ example: "bad.yaml", context: { prompt: "x" } }),
    });

    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toMatch(/bad\.yaml:\d+:\d+/);
  });

  it("supports emergency stop-all", async () => {
    const ctx = setupDagTestApp();
    cleanups.push(ctx.cleanup);

    const res = await ctx.app.request("/api/dag/runs/stop-all", { method: "POST" });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; stopped: number };
    expect(body.ok).toBe(true);
    expect(body.stopped).toBeGreaterThanOrEqual(0);
  });
});
