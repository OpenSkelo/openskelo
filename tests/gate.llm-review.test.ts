import { describe, expect, it } from "vitest";
import { createDAGExecutor } from "../src/core/dag-executor";
import type { DAGDef } from "../src/core/block";
import type { ProviderAdapter, DispatchRequest, DispatchResult } from "../src/types";

function dagWithLLMReview(passThreshold = 1): DAGDef {
  return {
    name: "llm-review-dag",
    blocks: [
      {
        id: "draft",
        name: "Draft",
        inputs: { prompt: { type: "string", required: true } },
        outputs: { answer: { type: "string", required: true } },
        agent: { specific: "worker" },
        pre_gates: [],
        post_gates: [
          {
            name: "judge",
            check: {
              type: "llm_review",
              port: "answer",
              criteria: ["Mentions security", "Mentions tests"],
              provider: "reviewProvider",
              model: "judge-model",
              pass_threshold: passThreshold,
              timeout_ms: 5000,
            },
            error: "LLM review failed",
          },
        ],
        retry: { max_attempts: 0, backoff: "none", delay_ms: 0 },
      },
    ],
    edges: [],
  };
}

function makeProvider(onDispatch: (req: DispatchRequest) => DispatchResult): ProviderAdapter {
  return {
    name: "mock",
    type: "mock",
    async dispatch(req: DispatchRequest): Promise<DispatchResult> {
      return onDispatch(req);
    },
  };
}

describe("gate type: llm_review", () => {
  it("passes when judge criteria meet threshold", async () => {
    const dag = dagWithLLMReview(1);
    const executor = createDAGExecutor({
      providers: {
        workerProvider: makeProvider(() => ({ success: true, output: JSON.stringify({ answer: "security and tests are included" }) })),
        reviewProvider: makeProvider((req) => {
          if (String(req.title).startsWith("LLM Review:")) {
            return {
              success: true,
              output: JSON.stringify({
                criteria: [
                  { criterion: "Mentions security", passed: true, reason: "found" },
                  { criterion: "Mentions tests", passed: true, reason: "found" },
                ],
                summary: "good",
              }),
            };
          }
          return { success: true, output: JSON.stringify({ answer: "security and tests are included" }) };
        }),
      },
      agents: {
        worker: { role: "worker", capabilities: ["coding"], provider: "workerProvider", model: "gen-model" },
      },
    });

    const result = await executor.execute(dag, { prompt: "x" });
    expect(result.run.status).toBe("completed");
    expect(result.run.blocks.draft.post_gate_results[0]?.passed).toBe(true);
    expect(result.run.blocks.draft.post_gate_results[0]?.audit?.gate_type).toBe("llm_review");
  });

  it("fails closed on malformed review output", async () => {
    const dag = dagWithLLMReview(1);
    const executor = createDAGExecutor({
      providers: {
        workerProvider: makeProvider(() => ({ success: true, output: JSON.stringify({ answer: "security and tests are included" }) })),
        reviewProvider: makeProvider((req) => {
          if (String(req.title).startsWith("LLM Review:")) {
            return { success: true, output: "not-json" };
          }
          return { success: true, output: JSON.stringify({ answer: "security and tests are included" }) };
        }),
      },
      agents: {
        worker: { role: "worker", capabilities: ["coding"], provider: "workerProvider", model: "gen-model" },
      },
    });

    const result = await executor.execute(dag, { prompt: "x" });
    expect(result.run.status).toBe("failed");
    expect(result.run.blocks.draft.post_gate_results[0]?.passed).toBe(false);
    expect(String(result.run.blocks.draft.post_gate_results[0]?.audit?.failure ?? "")).toContain("invalid_review_output");
  });
});
