import { describe, expect, it } from "vitest";
import { createDAGExecutor } from "../src/core/dag-executor";
import { createBlockEngine, type DAGDef } from "../src/core/block";
import type { ProviderAdapter, DispatchRequest, DispatchResult } from "../src/types";

function dagWithLLMReview(passThreshold = 1, extras?: Partial<DAGDef["blocks"][0]>): DAGDef {
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
              criteria: ["Mentions security", "Mentions tests", "No hardcoded values", "Handles errors"],
              provider: "reviewProvider",
              model: "judge-model",
              pass_threshold: passThreshold,
              timeout_ms: 5000,
              system_prompt: "You are a strict code reviewer.",
            },
            error: "LLM review failed",
          },
        ],
        on_gate_fail: [],
        retry: { max_attempts: 0, backoff: "none", delay_ms: 0 },
        ...(extras ?? {}),
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

function baseExecutor(reviewDispatch: (req: DispatchRequest) => DispatchResult) {
  return createDAGExecutor({
    providers: {
      workerProvider: makeProvider(() => ({ success: true, output: JSON.stringify({ answer: "security and tests included; no hardcoded values; robust errors" }) })),
      reviewProvider: makeProvider((req) => {
        if (String(req.title).startsWith("LLM Review:")) return reviewDispatch(req);
        return { success: true, output: JSON.stringify({ answer: "security and tests included; no hardcoded values; robust errors" }) };
      }),
    },
    agents: {
      worker: { role: "worker", capabilities: ["coding"], provider: "workerProvider", model: "gen-model" },
    },
  });
}

describe("gate type: llm_review", () => {
  it("clean pass: all criteria met at threshold 1.0", async () => {
    let capturedSystem: string | undefined;
    const executor = baseExecutor((req) => {
      capturedSystem = req.system;
      return {
        success: true,
        output: JSON.stringify([
          { criterion: "Mentions security", passed: true, reasoning: "found" },
          { criterion: "Mentions tests", passed: true, reasoning: "found" },
          { criterion: "No hardcoded values", passed: true, reasoning: "found" },
          { criterion: "Handles errors", passed: true, reasoning: "found" },
        ]),
        tokensUsed: 42,
      };
    });

    const result = await executor.execute(dagWithLLMReview(1), { prompt: "x" });
    expect(result.run.status).toBe("completed");
    expect(result.run.blocks.draft.post_gate_results[0]?.passed).toBe(true);
    expect(capturedSystem).toContain("strict code reviewer");
  });

  it("clean fail: 2/4 fail at threshold 1.0", async () => {
    const executor = baseExecutor(() => ({
      success: true,
      output: JSON.stringify([
        { criterion: "Mentions security", passed: true, reasoning: "ok" },
        { criterion: "Mentions tests", passed: true, reasoning: "ok" },
        { criterion: "No hardcoded values", passed: false, reasoning: "port 3000 hardcoded" },
        { criterion: "Handles errors", passed: false, reasoning: "missing catch" },
      ]),
    }));

    const result = await executor.execute(dagWithLLMReview(1), { prompt: "x" });
    expect(result.run.status).toBe("failed");
    expect(result.run.blocks.draft.post_gate_results[0]?.passed).toBe(false);
  });

  it("threshold logic: 2/4 passes at threshold 0.5", async () => {
    const executor = baseExecutor(() => ({
      success: true,
      output: JSON.stringify([
        { criterion: "Mentions security", passed: true, reasoning: "ok" },
        { criterion: "Mentions tests", passed: true, reasoning: "ok" },
        { criterion: "No hardcoded values", passed: false, reasoning: "hardcoded" },
        { criterion: "Handles errors", passed: false, reasoning: "missing" },
      ]),
    }));

    const result = await executor.execute(dagWithLLMReview(0.5), { prompt: "x" });
    expect(result.run.status).toBe("completed");
    expect(result.run.blocks.draft.post_gate_results[0]?.passed).toBe(true);
  });

  it("malformed LLM response fails gracefully (no crash)", async () => {
    const executor = baseExecutor(() => ({ success: true, output: "not-json" }));
    const result = await executor.execute(dagWithLLMReview(1), { prompt: "x" });
    expect(result.run.status).toBe("failed");
    const gate = result.run.blocks.draft.post_gate_results[0];
    expect(gate?.passed).toBe(false);
    expect(String(gate?.audit?.failure ?? "")).toContain("invalid_review_output");
  });

  it("supports wrapped response format {criteria:[...]}", async () => {
    const executor = baseExecutor(() => ({
      success: true,
      output: JSON.stringify({
        criteria: [
          { criterion: "Mentions security", passed: true, reason: "ok" },
          { criterion: "Mentions tests", passed: true, reason: "ok" },
          { criterion: "No hardcoded values", passed: true, reason: "ok" },
          { criterion: "Handles errors", passed: true, reason: "ok" },
        ],
        summary: "all good",
      }),
    }));
    const result = await executor.execute(dagWithLLMReview(1), { prompt: "x" });
    expect(result.run.status).toBe("completed");
    const gate = result.run.blocks.draft.post_gate_results[0];
    expect(gate?.passed).toBe(true);
    expect(gate?.audit?.summary).toBe("all good");
  });

  it("propagates failed verdicts into run.context.gate_verdicts on bounce", async () => {
    const dag = dagWithLLMReview(1, {
      on_gate_fail: [
        { when_gate: "judge", route_to: "draft", max_bounces: 1, feedback_from: "gate_verdicts" },
      ],
    });

    const executor = baseExecutor(() => ({
      success: true,
      output: JSON.stringify([
        { criterion: "Mentions security", passed: false, reasoning: "missing security" },
        { criterion: "Mentions tests", passed: false, reasoning: "missing tests" },
        { criterion: "No hardcoded values", passed: false, reasoning: "hardcoded values found" },
        { criterion: "Handles errors", passed: false, reasoning: "no error paths" },
      ]),
    }));

    const result = await executor.execute(dag, { prompt: "x" });
    expect(result.run.status).toBe("failed");
    expect(result.run.context.gate_verdicts).toBeTruthy();
    expect((result.run.context.gate_verdicts as Record<string, unknown>).gate).toBe("judge");
    expect((result.run.context.gate_verdicts as Record<string, unknown>).audit).toBeTruthy();
  });
});

describe("llm_review parse validation", () => {
  const engine = createBlockEngine();

  it("errors when provider/model are missing", () => {
    expect(() =>
      engine.parseDAG({
        name: "x",
        blocks: [
          {
            id: "b",
            name: "B",
            inputs: { prompt: "string" },
            outputs: { answer: "string" },
            agent: { specific: "worker" },
            pre_gates: [],
            post_gates: [
              {
                name: "judge",
                check: { type: "llm_review", port: "answer", criteria: ["one"] },
                error: "bad",
              },
            ],
            retry: { max_attempts: 0, backoff: "none", delay_ms: 0 },
          },
        ],
        edges: [],
      })
    ).toThrow(/provider/i);
  });

  it("errors when criteria array is empty", () => {
    expect(() =>
      engine.parseDAG({
        name: "x",
        blocks: [
          {
            id: "b",
            name: "B",
            inputs: { prompt: "string" },
            outputs: { answer: "string" },
            agent: { specific: "worker" },
            pre_gates: [],
            post_gates: [
              {
                name: "judge",
                check: {
                  type: "llm_review",
                  port: "answer",
                  criteria: [],
                  provider: "p",
                  model: "m",
                },
                error: "bad",
              },
            ],
            retry: { max_attempts: 0, backoff: "none", delay_ms: 0 },
          },
        ],
        edges: [],
      })
    ).toThrow(/criteria/i);
  });
});
