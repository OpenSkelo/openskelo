import { describe, expect, it, vi, afterEach } from "vitest";
import { AnthropicProvider } from "../../src/runtimes/providers/anthropic.js";

describe("AnthropicProvider tool message mapping", () => {
  afterEach(() => vi.restoreAllMocks());

  it("sends assistant tool_use and user tool_result blocks", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch" as any).mockResolvedValue({
      ok: true,
      json: async () => ({
        model: "MiniMax-M2.5",
        content: [{ type: "text", text: "done" }],
        usage: { input_tokens: 10, output_tokens: 5 },
        stop_reason: "end_turn",
      }),
    } as Response);

    const provider = new AnthropicProvider("k", "https://api.minimax.io/anthropic/v1");

    await provider.complete({
      model: "MiniMax-M2.5",
      messages: [
        { role: "system", content: "sys" },
        { role: "user", content: "go" },
        {
          role: "assistant",
          content: "",
          toolCalls: [{ id: "tc1", name: "search", input: { q: "x" } }],
        },
        { role: "tool", toolUseId: "tc1", content: "result" },
      ],
    });

    const init = fetchSpy.mock.calls[0]?.[1] as RequestInit;
    const body = JSON.parse(String(init.body));
    expect(body.messages[1].role).toBe("assistant");
    expect(body.messages[1].content[0].type).toBe("tool_use");
    expect(body.messages[2].role).toBe("user");
    expect(body.messages[2].content[0].type).toBe("tool_result");
    expect(body.messages[2].content[0].tool_use_id).toBe("tc1");
  });
});
