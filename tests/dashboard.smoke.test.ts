import { describe, it, expect, beforeAll } from "vitest";
import { createAPI } from "../src/server/api.js";
import { createDAGAPI } from "../src/server/dag-api.js";
import { getDAGDashboardHTML } from "../src/server/dag-dashboard.js";
import { resolve } from "node:path";

/**
 * Dashboard smoke tests — prevents the "empty dropdown" and "JS syntax error
 * in template literal" class of regressions that break the UI silently.
 */

const TEST_CONFIG = {
  name: "smoke-test",
  providers: [{ name: "local", type: "ollama" as const, url: "http://localhost:11434" }],
  agents: {
    worker: { role: "worker", capabilities: ["general"], provider: "local", model: "llama3:8b", max_concurrent: 1 },
  },
  pipelines: { default: { stages: [{ name: "PENDING" }] } },
  gates: [],
  storage: "sqlite" as const,
  dashboard: { enabled: true, port: 0 },
};

describe("Dashboard Smoke Tests", () => {
  let app: ReturnType<typeof createAPI>;

  beforeAll(() => {
    app = createAPI({ config: TEST_CONFIG });
    const dagAPI = createDAGAPI(TEST_CONFIG, {
      examplesDir: resolve(__dirname, "../examples"),
    });
    app.route("/", dagAPI);
    app.get("/dag", (c) => c.html(getDAGDashboardHTML("smoke-test", 4040, { liveMode: true })));
  });

  it("GET /dag returns 200 with HTML", async () => {
    const res = await app.request("/dag");
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("<!DOCTYPE html>");
    expect(html).toContain("<select");
  });

  it("dashboard HTML keeps escaped newline literals in embedded JS", async () => {
    const res = await app.request("/dag");
    const html = await res.text();
    // Regression check for prior bug where '\\n' was emitted as a raw newline in a JS string.
    expect(html).toContain("Input mismatch: ");
    expect(html).toContain("lines.join('\\n')");
  });

  it("GET /api/dag/examples returns pipeline list", async () => {
    const res = await app.request("/api/dag/examples");
    expect(res.status).toBe(200);
    const data = (await res.json()) as { examples?: Array<{ name: string; file: string }> };
    expect(Array.isArray(data.examples)).toBe(true);
    expect((data.examples ?? []).length).toBeGreaterThan(0);
  });

  it("all listed examples are valid DAG names", async () => {
    const res = await app.request("/api/dag/examples");
    const data = (await res.json()) as { examples?: Array<{ name: string; file: string }> };
    for (const ex of data.examples ?? []) {
      expect(ex.file).toMatch(/\.ya?ml$/);
      // Each example should be a local file name (no traversal)
      expect(ex.file).not.toContain("/");
      expect(ex.file).not.toContain("..");
    }
  });

  it("GET /api/health returns ok", async () => {
    const res = await app.request("/api/health");
    expect(res.status).toBe(200);
    const data = (await res.json()) as { status?: string };
    expect(data.status).toBe("ok");
  });

  it("GET /api/dag/examples has CORS headers", async () => {
    const res = await app.request("/api/dag/examples", {
      headers: { Origin: "http://localhost:3000" },
    });
    // Hono cors() middleware should add this
    const acao = res.headers.get("access-control-allow-origin");
    expect(acao).toBeTruthy();
  });
});
