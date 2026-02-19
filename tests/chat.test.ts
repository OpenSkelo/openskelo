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

  it("passes port_not_empty when content exists", () => {
    const gates = evaluateAgentGates(baseAgent, "hello");
    expect(gates[0].passed).toBe(true);
  });

  it("fails port_not_empty for blank content", () => {
    const gates = evaluateAgentGates(baseAgent, "");
    expect(gates[0].passed).toBe(false);
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
