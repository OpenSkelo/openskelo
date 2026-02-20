import type {
  CompletionRequest,
  CompletionResponse,
  LLMProvider,
  ToolCall,
} from "./types.js";

export class AnthropicProvider implements LLMProvider {
  name = "anthropic";
  private apiKey: string;
  private baseURL: string;

  constructor(apiKey: string, baseURL = "https://api.anthropic.com/v1") {
    this.apiKey = apiKey;
    this.baseURL = baseURL;
  }

  async complete(request: CompletionRequest): Promise<CompletionResponse> {
    const start = Date.now();
    const controller = new AbortController();
    const timeout = request.timeoutMs
      ? setTimeout(() => controller.abort("timeout"), request.timeoutMs)
      : null;

    try {
      const system = request.messages.find((m) => m.role === "system")?.content;
      const messages = request.messages
        .filter((m) => m.role !== "system")
        .map((m) => {
          if (m.role === "tool") {
            return {
              role: "user",
              content: [
                {
                  type: "tool_result",
                  tool_use_id: m.toolUseId,
                  content: m.content,
                },
              ],
            };
          }

          if (m.role === "assistant" && m.toolCalls?.length) {
            const content: Array<Record<string, unknown>> = [];
            if (m.content?.trim()) content.push({ type: "text", text: m.content });
            for (const call of m.toolCalls) {
              content.push({
                type: "tool_use",
                id: call.id,
                name: call.name,
                input: call.input,
              });
            }
            return { role: "assistant", content };
          }

          return {
            role: m.role,
            content: [{ type: "text", text: m.content }],
          };
        });

      const body: Record<string, unknown> = {
        model: request.model,
        max_tokens: request.maxTokens ?? 4096,
        messages,
      };
      if (system) body.system = system;
      if (typeof request.temperature === "number") body.temperature = request.temperature;
      if (request.tools?.length) {
        body.tools = request.tools.map((t) => ({
          name: t.name,
          description: t.description,
          input_schema: t.inputSchema,
        }));
      }

      const res = await fetch(`${this.baseURL}/messages`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-api-key": this.apiKey,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      if (!res.ok) {
        const txt = await res.text();
        throw new Error(`anthropic provider error ${res.status}: ${txt}`);
      }

      const json = (await res.json()) as any;
      const contentBlocks = Array.isArray(json?.content) ? json.content : [];
      const text = contentBlocks
        .filter((b: any) => b?.type === "text")
        .map((b: any) => String(b?.text ?? ""))
        .join("");

      const toolCalls: ToolCall[] = contentBlocks
        .filter((b: any) => b?.type === "tool_use")
        .map((b: any) => ({
          id: String(b.id),
          name: String(b.name),
          input: (b.input && typeof b.input === "object") ? b.input : {},
        }));

      return {
        content: text,
        stopReason: json?.stop_reason === "tool_use" ? "tool_use" : "end_turn",
        toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
        usage: {
          inputTokens: Number(json?.usage?.input_tokens ?? 0),
          outputTokens: Number(json?.usage?.output_tokens ?? 0),
        },
        model: String(json?.model ?? request.model),
        durationMs: Date.now() - start,
      };
    } finally {
      if (timeout) clearTimeout(timeout);
    }
  }

  supportsStreaming(): boolean {
    return true;
  }
}
