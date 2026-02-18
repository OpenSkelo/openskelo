import { describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { initProject } from "../src/commands/init";
import { parseYamlWithDiagnostics } from "../src/core/yaml-utils";
import { createBlockEngine } from "../src/core/block";

const TEMPLATES = ["coding", "research", "content", "custom"] as const;

describe("init templates (v2 DAG-first)", () => {
  it("generates DAG example files that parse successfully", async () => {
    const base = mkdtempSync(join(tmpdir(), "openskelo-init-"));
    const engine = createBlockEngine();

    try {
      for (const template of TEMPLATES) {
        const projectName = `proj-${template}`;
        await initProject(projectName, template, { cwd: base });

        const dagPath = join(base, projectName, "examples", `${template}.yaml`);
        const raw = parseYamlWithDiagnostics(readFileSync(dagPath, "utf8"), dagPath);
        const dag = engine.parseDAG(raw as Record<string, unknown>);

        expect(Array.isArray(dag.blocks)).toBe(true);
        expect(dag.blocks.length).toBeGreaterThan(0);
      }
    } finally {
      rmSync(base, { recursive: true, force: true });
    }
  });

  it("does not emit legacy pipeline/stage schema in skelo.yaml", async () => {
    const base = mkdtempSync(join(tmpdir(), "openskelo-init-"));

    try {
      await initProject("proj-legacy-guard", "coding", { cwd: base });

      const cfgPath = join(base, "proj-legacy-guard", "skelo.yaml");
      const cfg = readFileSync(cfgPath, "utf8");

      expect(cfg).not.toMatch(/\bpipelines\s*:/);
      expect(cfg).not.toMatch(/\bstages\s*:/);
      expect(cfg).toMatch(/\bagents\s*:/);
      expect(cfg).toMatch(/\bproviders\s*:/);
    } finally {
      rmSync(base, { recursive: true, force: true });
    }
  });
});
