import { describe, expect, it, vi } from "vitest";
import { DirectRuntime } from "../../src/runtimes/direct-runtime.js";
import { calculateCost } from "../../src/runtimes/cost-calculator.js";
import type { LLMProvider } from "../../src/runtimes/providers/types.js";

describe("DirectRuntime", () => {
  it("dispatches simple completion without tools", async () => {
    const mockProvider: LLMProvider = {
      name: "mock",
      supportsStreaming: () => false,
      complete: vi.fn().mockResolvedValue({
        content: "BNO is at $28.50",
        stopReason: "end_turn",
        usage: { inputTokens: 100, outputTokens: 50 },
        model: "claude-haiku-4-5",
        durationMs: 20,
      }),
    };

    const runtime = new DirectRuntime({
      providers: new Map([["mock", mockProvider]]),
      modelToProvider: new Map([["test-model", "mock"]]),
    });

    const result = await runtime.dispatch({
      agentId: "scout",
      system: "You are a scanner",
      userMessage: "scan BNO",
      inputs: {},
      model: "test-model",
    });

    expect(result.content).toBe("BNO is at $28.50");
    expect(result.tokens.input).toBe(100);
    expect(result.tokens.output).toBe(50);
    expect(result.toolCalls).toHaveLength(0);
  });

  it("executes tool loop until end_turn", async () => {
    const complete = vi
      .fn()
      .mockResolvedValueOnce({
        content: "",
        stopReason: "tool_use",
        toolCalls: [{ id: "tc1", name: "web_search", input: { query: "BNO" } }],
        usage: { inputTokens: 100, outputTokens: 30 },
        model: "test-model",
        durationMs: 20,
      })
      .mockResolvedValueOnce({
        content: "BNO is $28.50",
        stopReason: "end_turn",
        usage: { inputTokens: 120, outputTokens: 45 },
        model: "test-model",
        durationMs: 20,
      });

    const mockProvider: LLMProvider = {
      name: "mock",
      supportsStreaming: () => false,
      complete,
    };

    const toolExecutor = vi.fn().mockResolvedValue({
      toolUseId: "tc1",
      content: "BNO result",
    });

    const runtime = new DirectRuntime({
      providers: new Map([["mock", mockProvider]]),
      modelToProvider: new Map([["test-model", "mock"]]),
    });

    const result = await runtime.dispatch({
      agentId: "scout",
      system: "sys",
      userMessage: "msg",
      inputs: {},
      model: "test-model",
      tools: [{ name: "web_search", description: "search", inputSchema: {} }],
      toolExecutor,
    });

    expect(result.content).toBe("BNO is $28.50");
    expect(result.toolCalls).toHaveLength(1);
    expect(result.toolCalls[0].name).toBe("web_search");
    expect(result.tokens.input).toBe(220);
    expect(toolExecutor).toHaveBeenCalledTimes(1);
  });

  it("handles tool execution errors gracefully", async () => {
    const complete = vi
      .fn()
      .mockResolvedValueOnce({
        content: "",
        stopReason: "tool_use",
        toolCalls: [{ id: "tc1", name: "failing_tool", input: {} }],
        usage: { inputTokens: 50, outputTokens: 20 },
        model: "test-model",
        durationMs: 20,
      })
      .mockResolvedValueOnce({
        content: "best effort answer",
        stopReason: "end_turn",
        usage: { inputTokens: 80, outputTokens: 30 },
        model: "test-model",
        durationMs: 20,
      });

    const mockProvider: LLMProvider = {
      name: "mock",
      supportsStreaming: () => false,
      complete,
    };

    const runtime = new DirectRuntime({
      providers: new Map([["mock", mockProvider]]),
      modelToProvider: new Map([["test-model", "mock"]]),
    });

    const result = await runtime.dispatch({
      agentId: "a",
      system: "s",
      userMessage: "u",
      inputs: {},
      model: "test-model",
      tools: [{ name: "failing_tool", description: "", inputSchema: {} }],
      toolExecutor: async () => {
        throw new Error("Connection refused");
      },
    });

    expect(result.toolCalls[0].isError).toBe(true);
    expect(result.content).toContain("best effort");
  });

  it("fails after max tool loop iterations", async () => {
    const mockProvider: LLMProvider = {
      name: "mock",
      supportsStreaming: () => false,
      complete: vi.fn().mockResolvedValue({
        content: "",
        stopReason: "tool_use",
        toolCalls: [{ id: "tc", name: "loop", input: {} }],
        usage: { inputTokens: 1, outputTokens: 1 },
        model: "test-model",
        durationMs: 20,
      }),
    };

    const runtime = new DirectRuntime({
      providers: new Map([["mock", mockProvider]]),
      modelToProvider: new Map([["test-model", "mock"]]),
    });

    await expect(
      runtime.dispatch({
        agentId: "loop",
        system: "",
        userMessage: "",
        inputs: {},
        model: "test-model",
        tools: [{ name: "loop", description: "", inputSchema: {} }],
        toolExecutor: async () => ({ toolUseId: "tc", content: "ok" }),
      })
    ).rejects.toThrow(/exceeded/);
  });
});

describe("cost calculator", () => {
  it("calculates known model cost", () => {
    const cost = calculateCost("claude-haiku-4-5", { inputTokens: 1000, outputTokens: 500 });
    expect(cost).toBeCloseTo(0.0028, 4);
  });

  it("returns 0 for unknown model", () => {
    expect(calculateCost("unknown", { inputTokens: 1000, outputTokens: 500 })).toBe(0);
  });
});
