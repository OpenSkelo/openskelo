import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createDAGExecutor } from "../src/core/dag-executor";
import type { DAGDef } from "../src/core/block";
import type { DispatchRequest, ProviderAdapter } from "../src/types";

describe("block_dir integration", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "block-dir-int-"));
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  function makeDag(withBlockDir = true): DAGDef {
    return {
      name: "block-dir-int",
      blocks: [
        {
          id: "analyst",
          name: "Analyst",
          block_dir: withBlockDir ? "blocks/analyst" : undefined,
          inputs: { topic: { type: "string", required: true } },
          outputs: { summary: { type: "string", required: true } },
          agent: { role: "worker" },
          pre_gates: [],
          post_gates: [],
          retry: { max_attempts: 0, backoff: "none", delay_ms: 0 },
        },
      ],
      edges: [],
      entrypoints: ["analyst"],
      terminals: ["analyst"],
    };
  }

  function setupFiles() {
    const dir = join(tempDir, "blocks", "analyst");
    mkdirSync(join(dir, "context"), { recursive: true });
    mkdirSync(join(dir, "skills"), { recursive: true });
    mkdirSync(join(dir, "policies"), { recursive: true });
    writeFileSync(join(dir, "role.md"), "ROLE: You are a specialist analyst.");
    writeFileSync(join(dir, "rules.md"), "RULE: Never fabricate data.");
    writeFileSync(join(dir, "task.md"), "TASK: Return exactly one concise summary.");
    writeFileSync(join(dir, "context", "b.md"), "CTX-B");
    writeFileSync(join(dir, "context", "a.md"), "CTX-A");
    writeFileSync(
      join(dir, "skills", "analysis.md"),
      [
        "---",
        "name: analyst-skill",
        "description: Analyze topics with concise output",
        "---",
        "Full body that should not be injected.",
      ].join("\n")
    );
    writeFileSync(
      join(dir, "policies", "GP-001.yaml"),
      [
        "id: GP-001",
        "status: active",
        "trigger: after summarizing",
        "action: verify claims",
        "severity: P1",
      ].join("\n")
    );
  }

  const agents = {
    worker: { role: "worker", capabilities: ["general"], provider: "local", model: "test-model" },
  };

  it("system prompt follows role → rules → policies → skills → context order", async () => {
    setupFiles();
    let captured: DispatchRequest | null = null;

    const provider: ProviderAdapter = {
      name: "local",
      type: "test",
      async dispatch(req) {
        captured = req;
        return { success: true, output: JSON.stringify({ summary: "ok" }) };
      },
    };

    const ex = createDAGExecutor({ providers: { local: provider }, agents, projectRoot: tempDir });
    const { run } = await ex.execute(makeDag(true), { topic: "x" });

    expect(run.status).toBe("completed");
    expect(captured?.system).toContain("ROLE: You are a specialist analyst.");
    expect(captured?.system).toContain("RULES — NEVER VIOLATE");
    expect(captured?.system).toContain("RULE: Never fabricate data.");
    expect(captured?.system).toContain("GATING POLICIES");
    expect(captured?.system).toContain("GP-001");
    expect(captured?.system).toContain("<available_skills>");
    expect(captured?.system).toContain("analyst-skill");
    expect(captured?.system).not.toContain("Full body that should not be injected");
    expect(captured?.system).toContain("CTX-A");
    expect(captured?.system).toContain("CTX-B");

    const sys = captured?.system ?? "";
    expect(sys.indexOf("ROLE:")).toBeLessThan(sys.indexOf("RULES — NEVER VIOLATE"));
    expect(sys.indexOf("RULES — NEVER VIOLATE")).toBeLessThan(sys.indexOf("GATING POLICIES"));
    expect(sys.indexOf("GATING POLICIES")).toBeLessThan(sys.indexOf("<available_skills>"));
    expect(sys.indexOf("<available_skills>")).toBeLessThan(sys.indexOf("CTX-A"));
    expect(sys.indexOf("CTX-A")).toBeLessThan(sys.indexOf("CTX-B"));
  });

  it("task.md is prepended to description before default block prompt", async () => {
    setupFiles();
    let captured: DispatchRequest | null = null;

    const provider: ProviderAdapter = {
      name: "local",
      type: "test",
      async dispatch(req) {
        captured = req;
        return { success: true, output: JSON.stringify({ summary: "ok" }) };
      },
    };

    const ex = createDAGExecutor({ providers: { local: provider }, agents, projectRoot: tempDir });
    const { run } = await ex.execute(makeDag(true), { topic: "x" });

    expect(run.status).toBe("completed");
    expect(captured?.description.startsWith("TASK: Return exactly one concise summary.")).toBe(true);
    expect(captured?.description).toContain("## Inputs");
  });

  it("block without block_dir keeps legacy behavior", async () => {
    let captured: DispatchRequest | null = null;

    const provider: ProviderAdapter = {
      name: "local",
      type: "test",
      async dispatch(req) {
        captured = req;
        return { success: true, output: JSON.stringify({ summary: "ok" }) };
      },
    };

    const ex = createDAGExecutor({ providers: { local: provider }, agents, projectRoot: tempDir });
    const { run } = await ex.execute(makeDag(false), { topic: "x" });

    expect(run.status).toBe("completed");
    expect(captured?.system).toBeUndefined();
    expect(captured?.description).toContain("# Block: Analyst");
    expect(captured?.description).toContain("## Inputs");
  });
});
