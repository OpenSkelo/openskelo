import { describe, it, expect } from "vitest";
import { createBlockEngine } from "../src/core/block";
import type { DAGDef } from "../src/core/block";

function dagWithJsonSchemaGate(): DAGDef {
  return {
    name: "json-schema-gate",
    blocks: [
      {
        id: "b1",
        name: "B1",
        inputs: { payload: { type: "json", required: true } },
        outputs: { out: { type: "string", required: false } },
        agent: { role: "worker" },
        pre_gates: [
          {
            name: "schema",
            check: {
              type: "json_schema",
              port: "payload",
              schema: {
                type: "object",
                required: ["title"],
                properties: {
                  title: { type: "string" },
                  count: { type: "number" },
                },
              },
            },
            error: "payload schema mismatch",
          },
        ],
        post_gates: [],
        retry: { max_attempts: 0, backoff: "none", delay_ms: 0 },
      },
    ],
    edges: [],
    entrypoints: ["b1"],
    terminals: ["b1"],
  };
}

describe("gate type: json_schema", () => {
  it("passes when payload satisfies schema", () => {
    const engine = createBlockEngine();
    const dag = engine.parseDAG(dagWithJsonSchemaGate() as unknown as Record<string, unknown>);
    const results = engine.evaluatePreGates(dag.blocks[0], { payload: { title: "hello", count: 2 } });
    expect(results[0].passed).toBe(true);
  });

  it("fails when required property is missing", () => {
    const engine = createBlockEngine();
    const dag = engine.parseDAG(dagWithJsonSchemaGate() as unknown as Record<string, unknown>);
    const results = engine.evaluatePreGates(dag.blocks[0], { payload: { count: 2 } });
    expect(results[0].passed).toBe(false);
    expect(String(results[0].reason ?? "")).toContain("missing required key");
  });
});
