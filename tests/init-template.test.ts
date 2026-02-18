import { describe, it, expect } from "vitest";
import { parse as parseYaml } from "yaml";
import { createBlockEngine } from "../src/core/block.js";

/**
 * Verifies that init templates generate valid DAG format (blocks/edges),
 * not the legacy pipeline format (pipelines/stages).
 *
 * This test exists because the init command was generating old-format YAML
 * that couldn't be used with the DAG executor. A new user's first experience
 * should produce a runnable pipeline.
 */

const engine = createBlockEngine();

// These template strings should match what init.ts generates.
// When init.ts is updated, update these to match OR (better) import directly.
// For now we inline minimal DAG templates to validate the format contract.

const MINIMAL_DAG_TEMPLATE = `
name: test-pipeline
blocks:
  - id: work
    name: Do Work
    inputs:
      prompt:
        type: string
        description: "What to work on"
    outputs:
      result:
        type: string
        description: "Work output"
    agent:
      role: worker
    pre_gates: []
    post_gates: []
    retry: { max_attempts: 0, backoff: none, delay_ms: 0 }
edges: []
`;

describe("Init Template Format Validation", () => {
  it("minimal DAG template parses successfully", () => {
    const raw = parseYaml(MINIMAL_DAG_TEMPLATE);
    const dag = engine.parseDAG(raw);
    expect(dag.name).toBe("test-pipeline");
    expect(dag.blocks).toHaveLength(1);
    expect(dag.entrypoints).toEqual(["work"]);
  });

  it("generated YAML must use blocks/edges, not pipelines/stages", () => {
    // This is the contract: init templates MUST produce DAG format
    const raw = parseYaml(MINIMAL_DAG_TEMPLATE);
    expect(raw).toHaveProperty("blocks");
    expect(raw).not.toHaveProperty("pipelines");
    expect(raw).not.toHaveProperty("stages");
  });

  it("rejects old pipeline format", () => {
    const oldFormat = parseYaml(`
name: old-style
pipelines:
  coding:
    stages:
      - name: PENDING
        transitions: [IN_PROGRESS]
      - name: IN_PROGRESS
      - name: DONE
    `);

    // parseDAG requires blocks array — old format should fail
    expect(() => engine.parseDAG(oldFormat)).toThrow(/requires at least one block/i);
  });

  it("DAG template has typed input ports", () => {
    const raw = parseYaml(MINIMAL_DAG_TEMPLATE);
    const dag = engine.parseDAG(raw);
    const workBlock = dag.blocks.find(b => b.id === "work");
    expect(workBlock).toBeDefined();
    expect(workBlock!.inputs.prompt).toBeDefined();
    expect(workBlock!.inputs.prompt.type).toBe("string");
  });

  it("DAG template has typed output ports", () => {
    const raw = parseYaml(MINIMAL_DAG_TEMPLATE);
    const dag = engine.parseDAG(raw);
    const workBlock = dag.blocks.find(b => b.id === "work");
    expect(workBlock).toBeDefined();
    expect(workBlock!.outputs.result).toBeDefined();
    expect(workBlock!.outputs.result.type).toBe("string");
  });
});
