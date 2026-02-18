import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseYamlWithDiagnostics } from "../src/core/yaml-utils";
import { createBlockEngine } from "../src/core/block";

describe("examples are DAG-only and parse cleanly", () => {
  it("all example yaml files parse as DAG definitions without legacy task keys", () => {
    const examplesDir = resolve(process.cwd(), "examples");
    const files = readdirSync(examplesDir).filter((f) => f.endsWith(".yaml") || f.endsWith(".yml"));
    const engine = createBlockEngine();

    expect(files.length).toBeGreaterThan(0);

    for (const file of files) {
      const full = resolve(examplesDir, file);
      const raw = parseYamlWithDiagnostics<Record<string, unknown>>(readFileSync(full, "utf-8"), full);

      // legacy template guardrails
      expect(raw.tasks).toBeUndefined();
      expect(raw.steps).toBeUndefined();

      const dag = engine.parseDAG(raw);
      expect(dag.blocks.length).toBeGreaterThan(0);
      expect(Array.isArray(dag.entrypoints)).toBe(true);
      expect(Array.isArray(dag.terminals)).toBe(true);
    }
  });
});
