import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createDB, closeDB } from "../src/core/db";
import { createAPI } from "../src/server/api";
import { createDAGAPI } from "../src/server/dag-api";
import { createTaskEngine } from "../src/core/task-engine";
import { createGateEngine } from "../src/core/gate-engine";
import { createRouter } from "../src/core/router";
import type { SkeloConfig } from "../src/types";

const cleanups: Array<() => void> = [];
afterEach(() => {
  while (cleanups.length) cleanups.pop()?.();
});

function createTestConfig(): SkeloConfig {
  return {
    name: "OpenSkelo DAG Test",
    storage: "sqlite",
    providers: [{ name: "local", type: "openclaw" }],
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

function setupDagTestApp() {
  const workdir = mkdtempSync(join(tmpdir(), "openskelo-dag-test-"));
  const config = createTestConfig();
  createDB(workdir);

  const taskEngine = createTaskEngine(config.pipelines);
  const gateEngine = createGateEngine(config.gates);
  const router = createRouter(config.agents, config.pipelines);
  const app = createAPI({ config, taskEngine, gateEngine, router });

  const examplesDir = resolve(__dirname, "../examples");
  const dagAPI = createDAGAPI(config, { examplesDir });
  app.route("/", dagAPI);

  return {
    app,
    cleanup: () => closeDB(),
  };
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

  it("rejects invalid agentMapping targets", async () => {
    const ctx = setupDagTestApp();
    cleanups.push(ctx.cleanup);

    const res = await ctx.app.request("/api/dag/run", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        example: "coding-pipeline.yaml",
        provider: "openclaw",
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
    const ctx = setupDagTestApp();
    cleanups.push(ctx.cleanup);

    const start = await ctx.app.request("/api/dag/run", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        example: "coding-pipeline.yaml",
        provider: "openclaw",
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
