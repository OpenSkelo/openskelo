import { describe, expect, it, vi, beforeEach } from "vitest";

const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

vi.mock("../src/agents/loader.js", () => ({
  loadAgent: vi.fn(async () => ({
    id: "nora",
    name: "Nora",
    model: { primary: "gpt-4o-mini", fallbacks: [], params: {} },
    retry: { max_attempts: 1, backoff_ms: 0 },
    timeout_ms: 10000,
    on_gate_fail: [],
    gates: { pre: [], post: [] },
  })),
}));

vi.mock("../src/commands/chat.js", () => ({
  createRuntime: vi.fn(() => ({})),
  buildSystemPrompt: vi.fn(() => "SYSTEM"),
  executeChatTurn: vi.fn(async () => ({
    result: {
      modelUsed: "gpt-4o-mini",
      content: "hello",
      outputs: { default: "hello" },
      tokens: { input: 10, output: 5 },
      cost: 0.001,
    },
    gates: [{ name: "x", passed: true }],
  })),
}));

describe("askCommand", () => {
  beforeEach(() => {
    logSpy.mockClear();
    process.exitCode = 0;
  });

  it("prints json output", async () => {
    const { askCommand } = await import("../src/commands/ask.js");
    await askCommand("nora", "hello", { json: true, projectDir: process.cwd() });

    expect(logSpy).toHaveBeenCalled();
    const out = String((logSpy.mock.calls.at(-1) ?? [""])[0]);
    expect(out).toContain('"agent": "nora"');
    expect(out).toContain('"content": "hello"');
  });
});
