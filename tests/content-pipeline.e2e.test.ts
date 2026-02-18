import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createDB, closeDB } from "../src/core/db";
import { createAPI } from "../src/server/api";
import { createDAGAPI } from "../src/server/dag-api";
import type { SkeloConfig } from "../src/types";

const cleanups: Array<() => Promise<void> | void> = [];
afterEach(async () => {
  while (cleanups.length) {
    const fn = cleanups.pop();
    if (fn) await fn();
  }
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
    name: "OpenSkelo E2E Test",
    storage: "sqlite",
    providers: [{ name: "local", type: "http", url: "http://fake-openai/v1" }],
    dashboard: { enabled: false, port: 4040 },
    agents: {
      manager: { role: "manager", capabilities: ["planning"], provider: "local", model: "openai-codex/gpt-5.3-codex", max_concurrent: 1 },
      worker: { role: "worker", capabilities: ["writing", "coding"], provider: "local", model: "openai-codex/gpt-5.3-codex", max_concurrent: 1 },
      reviewer: { role: "reviewer", capabilities: ["writing", "qa"], provider: "local", model: "openai-codex/gpt-5.3-codex", max_concurrent: 1 },
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

function setupApp(examplesDir: string) {
  const workdir = mkdtempSync(join(tmpdir(), "openskelo-content-e2e-db-"));
  createDB(workdir);
  const app = createAPI({ config: createTestConfig() });
  const dagAPI = createDAGAPI(createTestConfig(), { examplesDir });
  app.route("/", dagAPI);
  return {
    app,
    cleanup: async () => {
      try {
        await app.request("/api/dag/runs/stop-all", { method: "POST" });
        await new Promise((r) => setTimeout(r, 25));
      } finally {
        closeDB();
      }
    },
  };
}

async function waitForRunStatus(app: { request: (path: string, init?: RequestInit) => Promise<Response> }, runId: string, wanted: string[], timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const res = await app.request(`/api/dag/runs/${runId}`);
    if (res.status === 200) {
      const body = (await res.json()) as { run: { status: string } };
      if (wanted.includes(body.run.status)) return body.run.status;
    }
    await new Promise((r) => setTimeout(r, 120));
  }
  throw new Error(`timeout waiting for run ${runId} status in [${wanted.join(",")}]`);
}

describe("content pipeline e2e", () => {
  it("completes and writes a real markdown file via deterministic publish", async () => {
    const tmp = mkdtempSync(join(tmpdir(), "openskelo-content-e2e-"));
    const examplesDir = join(tmp, "examples");
    mkdirSync(examplesDir, { recursive: true });

    const src = resolve(__dirname, "../examples/content-pipeline.yaml");
    const dag = readFileSync(src, "utf-8").replace(
      './output/content-{timestamp}.md',
      `${tmp}/output/content-{timestamp}.md`
    );
    writeFileSync(join(examplesDir, "content-pipeline.yaml"), dag, "utf-8");

    const restoreFetch = withFetchMock(async (input, init) => {
      const url = String(input);
      if (url.includes("/chat/completions")) {
        const body = init?.body ? JSON.parse(String(init.body)) as Record<string, unknown> : {};
        const msgArr = Array.isArray(body.messages) ? body.messages as Array<Record<string, unknown>> : [];
        const prompt = String((msgArr[msgArr.length - 1]?.content ?? ""));

        let output: Record<string, unknown>;
        if (prompt.includes("Block: Create Outline")) {
          output = {
            outline: { title: "E2E Outline", sections: [{ heading: "H1", points: ["p1"] }] },
            tone: "friendly",
          };
        } else if (prompt.includes("Block: Write Draft")) {
          output = {
            draft: "This is an end-to-end generated draft with enough characters to pass minimum length. ".repeat(12),
            word_count: 120,
          };
        } else {
          output = {
            final_markdown: "# E2E Report\n\nThis is final markdown content from the E2E test.",
            changelog: "tightened",
          };
        }

        return new Response(
          JSON.stringify({ model: "gpt", choices: [{ message: { content: JSON.stringify(output) } }], usage: { total_tokens: 10 } }),
          { status: 200, headers: { "content-type": "application/json" } }
        );
      }
      return new Response("not found", { status: 404 });
    });

    const ctx = setupApp(examplesDir);
    cleanups.push(() => {
      restoreFetch();
      ctx.cleanup();
    });

    const runRes = await ctx.app.request("/api/dag/run", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ example: "content-pipeline.yaml", context: { topic: "e2e topic" }, provider: "local" }),
    });

    expect(runRes.status).toBe(201);
    const started = (await runRes.json()) as { run_id: string };
    expect(started.run_id).toMatch(/^run_/);

    const status = await waitForRunStatus(ctx.app, started.run_id, ["completed", "failed"]);
    expect(status).toBe("completed");

    const finalRes = await ctx.app.request(`/api/dag/runs/${started.run_id}`);
    const finalBody = (await finalRes.json()) as {
      run: { blocks: Record<string, { outputs?: Record<string, unknown>; status: string }> };
    };

    const publish = finalBody.run.blocks.publish;
    expect(publish.status).toBe("completed");
    const path = String(publish.outputs?.desktop_file_path ?? "");
    expect(path.length).toBeGreaterThan(0);
    expect(existsSync(path)).toBe(true);

    const written = readFileSync(path, "utf-8");
    expect(written).toContain("E2E Report");
    expect(written).toContain("E2E test");
  });
});
