import { describe, expect, it } from "vitest";
import { planDagFromGoal, planDagWithRetry } from "../src/core/autopilot";

describe("autopilot planner", () => {
  it("generates valid DAG for coding goal", () => {
    const dag = planDagFromGoal("Add input validation to user registration endpoint");
    expect(dag.blocks.length).toBeGreaterThan(0);
    expect(dag.edges.length).toBeGreaterThan(0);
  });

  it("generates valid DAG for research goal", () => {
    const dag = planDagFromGoal("Research latest local LLM benchmarks");
    expect(dag.blocks.some((b) => b.id === "gather")).toBe(true);
  });

  it("retries when first candidate is invalid", () => {
    const dag = planDagWithRetry(
      "test goal",
      (_goal, attempt) => {
        if (attempt === 1) return { name: "bad", blocks: [], edges: [] };
        return {
          name: "good",
          blocks: [
            {
              id: "one",
              name: "One",
              inputs: { prompt: "string" },
              outputs: { out: "string" },
              agent: { role: "worker" },
              pre_gates: [],
              post_gates: [],
              retry: { max_attempts: 0, backoff: "none", delay_ms: 0 },
            },
          ],
          edges: [],
        };
      },
      2,
    );

    expect(dag.name).toBe("good");
    expect(dag.blocks.length).toBe(1);
  });
});
