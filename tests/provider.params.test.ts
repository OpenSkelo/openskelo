import { describe, it, expect } from "vitest";
import { createOpenAICompatibleProvider } from "../src/core/openai-compatible-provider";
import { createOllamaProvider } from "../src/core/ollama-provider";

function withFetchMock(mock: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>) {
  const original = globalThis.fetch;
  globalThis.fetch = (mock as unknown) as typeof fetch;
  return () => {
    globalThis.fetch = original;
  };
}

describe("provider model param passthrough", () => {
  it("passes model params to openai-compatible payload", async () => {
    let seenBody: Record<string, unknown> | null = null;
    const restore = withFetchMock(async (_input, init) => {
      seenBody = JSON.parse(String(init?.body ?? "{}"));
      return new Response(JSON.stringify({
        model: "gpt-4o-mini",
        choices: [{ message: { content: "ok" } }],
        usage: { total_tokens: 1 },
      }), { status: 200, headers: { "content-type": "application/json" } });
    });

    try {
      const provider = createOpenAICompatibleProvider({ name: "openai-compatible", baseUrl: "http://fake-openai/v1" });
      const res = await provider.dispatch({
        taskId: "t1",
        pipeline: "p",
        title: "x",
        description: "x",
        context: {},
        acceptanceCriteria: [],
        bounceCount: 0,
        agent: { id: "a", role: "worker", model: "gpt-4o-mini" },
        modelParams: { temperature: 0.9, top_p: 0.7, max_tokens: 123 },
      });

      expect(res.success).toBe(true);
      expect(seenBody?.temperature).toBe(0.9);
      expect(seenBody?.top_p).toBe(0.7);
      expect(seenBody?.max_tokens).toBe(123);
    } finally {
      restore();
    }
  });

  it("passes model params to ollama payload", async () => {
    let seenBody: Record<string, unknown> | null = null;
    const restore = withFetchMock(async (_input, init) => {
      seenBody = JSON.parse(String(init?.body ?? "{}"));
      return new Response(JSON.stringify({
        model: "llama3.1",
        message: { content: "ok" },
        prompt_eval_count: 1,
        eval_count: 1,
      }), { status: 200, headers: { "content-type": "application/json" } });
    });

    try {
      const provider = createOllamaProvider({ name: "ollama", baseUrl: "http://fake-ollama:11434" });
      const res = await provider.dispatch({
        taskId: "t1",
        pipeline: "p",
        title: "x",
        description: "x",
        context: {},
        acceptanceCriteria: [],
        bounceCount: 0,
        agent: { id: "a", role: "worker", model: "llama3.1" },
        modelParams: { options: { temperature: 0.1, top_p: 0.9 }, num_predict: 64 },
      });

      expect(res.success).toBe(true);
      expect((seenBody?.options as Record<string, unknown>)?.temperature).toBe(0.1);
      expect((seenBody?.options as Record<string, unknown>)?.top_p).toBe(0.9);
      expect(seenBody?.num_predict).toBe(64);
    } finally {
      restore();
    }
  });
});
