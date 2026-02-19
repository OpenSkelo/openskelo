import type {
  CompletionRequest,
  CompletionResponse,
  LLMProvider,
  Message,
  ToolCall,
} from "./types.js";

export class OpenAIProvider implements LLMProvider {
  name: string;
  private apiKey: string;
  private baseURL: string;

  constructor(apiKey: string, baseURL = "https://api.openai.com/v1", providerName = "openai") {
    this.apiKey = apiKey;
    this.baseURL = baseURL;
    this.name = providerName;
  }

  async complete(request: CompletionRequest): Promise<CompletionResponse> {
    const start = Date.now();
    const controller = new AbortController();
    const timeout = request.timeoutMs
      ? setTimeout(() => controller.abort("timeout"), request.timeoutMs)
      : null;

    try {
      const body: Record<string, unknown> = {
        model: request.model,
        messages: request.messages.map((m: Message) => ({ role: m.role, content: m.content })),
        max_tokens: request.maxTokens ?? 4096,
      };
      if (typeof request.temperature === "number") body.temperature = request.temperature;
      if (request.tools?.length) {
        body.tools = request.tools.map((t) => ({
          type: "function",
          function: {
            name: t.name,
            description: t.description,
            parameters: t.inputSchema,
          },
        }));
      }

      const res = await fetch(`${this.baseURL}/chat/completions`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      if (!res.ok) {
        const txt = await res.text();
        throw new Error(`openai provider error ${res.status}: ${txt}`);
      }

      const json = (await res.json()) as any;
      const choice = json?.choices?.[0];
      const toolCalls: ToolCall[] | undefined = choice?.message?.tool_calls?.map((tc: any) => ({
        id: String(tc.id),
        name: String(tc.function?.name ?? "unknown"),
        input: safeJson(tc.function?.arguments),
      }));

      return {
        content: String(choice?.message?.content ?? ""),
        stopReason: choice?.finish_reason === "tool_calls" ? "tool_use" : "end_turn",
        toolCalls,
        usage: {
          inputTokens: Number(json?.usage?.prompt_tokens ?? 0),
          outputTokens: Number(json?.usage?.completion_tokens ?? 0),
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

function safeJson(input: unknown): Record<string, unknown> {
  if (typeof input !== "string") return {};
  try {
    const parsed = JSON.parse(input);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}
