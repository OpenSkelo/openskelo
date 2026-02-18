import { describe, it, expect } from "vitest";
import { createBlockEngine } from "../src/core/block";
import type { DAGDef } from "../src/core/block";

function dagWithPattern(pattern: string): DAGDef {
  return {
    name: "fuzz-regex",
    blocks: [
      {
        id: "b1",
        name: "B1",
        inputs: { x: { type: "string", required: true } },
        outputs: { out: { type: "string", required: true } },
        agent: { role: "worker" },
        pre_gates: [
          {
            name: "rgx",
            check: { type: "port_matches", port: "x", pattern },
            error: "regex fail",
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

describe("security fuzz baseline", () => {
  it("rejects known unsafe regex patterns fast", () => {
    const engine = createBlockEngine();
    const unsafe = ["(a+)+$", "(x+x+)+y", "([a-zA-Z]+)*$", "(.*a){8}"];

    const t0 = Date.now();
    for (const p of unsafe) {
      expect(() => engine.parseDAG(dagWithPattern(p) as unknown as Record<string, unknown>)).toThrow(/ReDoS safety guard|Unsafe regex pattern/i);
    }
    const elapsed = Date.now() - t0;
    expect(elapsed).toBeLessThan(500);
  });

  it("fuzzes suspicious regex-like inputs without hang", () => {
    const engine = createBlockEngine();
    const seeds = ["(a+)+$", "(a|aa)+$", "(.*)+", "([a-z]+)+", "a{1,100}(a+)+$"];

    const t0 = Date.now();
    for (let i = 0; i < 200; i++) {
      const base = seeds[i % seeds.length];
      const pattern = `${base}${"a".repeat(i % 20)}`;
      try {
        engine.parseDAG(dagWithPattern(pattern) as unknown as Record<string, unknown>);
      } catch {
        // both parse success and guarded rejection are acceptable; must not hang
      }
    }
    const elapsed = Date.now() - t0;
    expect(elapsed).toBeLessThan(1500);
  });
});
