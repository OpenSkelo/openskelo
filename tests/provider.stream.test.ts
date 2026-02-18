import { describe, it, expect } from "vitest";
import { createMockProvider } from "../src/core/mock-provider";

describe("provider streaming interface baseline", () => {
  it("dispatchStream emits chunk and done on mock provider", async () => {
    const provider = createMockProvider({ minDelay: 1, maxDelay: 1, failureRate: 0 });
    expect(typeof provider.dispatchStream).toBe("function");

    const chunks: string[] = [];
    let done = false;

    const res = await provider.dispatchStream?.({
      taskId: "t1",
      pipeline: "p1",
      title: "Mock Block",
      description: "desc",
      context: {},
      acceptanceCriteria: [],
      bounceCount: 0,
      agent: { id: "a1", role: "worker", model: "mock" },
    }, {
      onChunk: (c) => chunks.push(c),
      onDone: () => { done = true; },
    });

    expect(res?.success).toBe(true);
    expect(chunks.length).toBeGreaterThan(0);
    expect(done).toBe(true);
  });
});
