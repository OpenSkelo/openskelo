import { describe, expect, it, vi } from "vitest";
import { executeChatTurn, evaluateAgentGates } from "../src/commands/chat.js";

describe("chat gate evaluation", () => {
  const baseAgent: any = {
    id: "nora",
    name: "Nora",
    model: { primary: "gpt-4o-mini", fallbacks: [], params: {} },
    timeout_ms: 30_000,
    retry: { max_attempts: 3, backoff_ms: 0 },
    on_gate_fail: [{ gate: "has-output", action: "retry", max: 1, feedback: "try again" }],
    gates: {
      pre: [],
      post: [
        { name: "has-output", check: { type: "port_not_empty", port: "default" }, error: "output required" },
      ],
    },
  };

  it("passes port_not_empty when content exists", async () => {
    const gates = await evaluateAgentGates(baseAgent, "hello");
    expect(gates[0].passed).toBe(true);
  });

  it("fails port_not_empty for blank content", async () => {
    const gates = await evaluateAgentGates(baseAgent, "");
    expect(gates[0].passed).toBe(false);
  });

  it("supports expression gates in chat runtime", async () => {
    const agent: any = {
      ...baseAgent,
      gates: {
        pre: [],
        post: [{ name: "has-hello", check: { type: "expression", expression: "outputs.default === 'hello world'" }, error: "missing hello" }],
      },
    };

    const pass = await evaluateAgentGates(agent, "hello world");
    const fail = await evaluateAgentGates(agent, "goodbye");

    expect(pass[0].passed).toBe(true);
    expect(fail[0].passed).toBe(false);
  });

  it("supports llm_review gates in chat runtime", async () => {
    const runtime: any = {
      dispatch: vi.fn().mockResolvedValue({
        outputs: { default: '[{"criterion":"Must mention hello","passed":true,"reasoning":"ok"}]' },
        content: '[{"criterion":"Must mention hello","passed":true,"reasoning":"ok"}]',
        tokens: { input: 11, output: 7 },
        cost: 0.0001,
        durationMs: 1,
        modelUsed: "gpt-4o-mini",
        toolCalls: [],
      }),
    };

    const agent: any = {
      ...baseAgent,
      gates: {
        pre: [],
        post: [{
          name: "review",
          check: { type: "llm_review", port: "default", criteria: ["Must mention hello"] },
          error: "review failed",
        }],
      },
    };

    const gates = await evaluateAgentGates(agent, "hello world", runtime);
    expect(gates[0].passed).toBe(true);
    expect(runtime.dispatch).toHaveBeenCalledTimes(1);
  });

  it("retries once when gate fails then succeeds", async () => {
    const runtime: any = {
      dispatch: vi
        .fn()
        .mockResolvedValueOnce({
          outputs: { default: "" },
          content: "",
          tokens: { input: 10, output: 1 },
          cost: 0.0001,
          durationMs: 1,
          modelUsed: "gpt-4o-mini",
          toolCalls: [],
        })
        .mockResolvedValueOnce({
          outputs: { default: "fixed" },
          content: "fixed",
          tokens: { input: 12, output: 4 },
          cost: 0.0002,
          durationMs: 1,
          modelUsed: "gpt-4o-mini",
          toolCalls: [],
        }),
    };

    const turn = await executeChatTurn(runtime, baseAgent, process.cwd(), "hello", []);
    expect(turn.result.content).toBe("fixed");
    expect(runtime.dispatch).toHaveBeenCalledTimes(2);
  });
});
