import type { DispatchRequest, DispatchResult, DispatchStreamHandlers, ProviderAdapter } from "../types.js";

export interface OpenAICompatibleProviderOpts {
  name: string;
  baseUrl?: string;
  apiKeyEnv?: string;
  authHeader?: string;
  model?: string;
  timeoutMs?: number;
}

export function createOpenAICompatibleProvider(opts: OpenAICompatibleProviderOpts): ProviderAdapter {
  const baseUrl = (opts.baseUrl ?? "https://api.openai.com/v1").replace(/\/$/, "");
  const authHeader = opts.authHeader ?? "Authorization";
  const timeoutMs = opts.timeoutMs ?? 120_000;

  return {
    name: opts.name,
    type: "openai-compatible",
    async dispatch(request: DispatchRequest): Promise<DispatchResult> {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), timeoutMs);
      const apiKey = opts.apiKeyEnv ? process.env[opts.apiKeyEnv] : process.env.OPENAI_API_KEY;

      try {
        const basePayload: Record<string, unknown> = {
          model: request.agent.model || opts.model || "gpt-4o-mini",
          messages: [
            {
              role: "user",
              content: buildPrompt(request),
            },
          ],
        };

        const payload = {
          ...basePayload,
          ...(request.modelParams ?? { temperature: 0.2 }),
        };

        const res = await fetch(`${baseUrl}/chat/completions`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...(apiKey ? { [authHeader]: authHeader.toLowerCase() === "authorization" ? `Bearer ${apiKey}` : apiKey } : {}),
          },
          body: JSON.stringify(payload),
          signal: request.abortSignal ?? controller.signal,
        });

        if (!res.ok) {
          const text = await safeText(res);
          return { success: false, error: `openai-compatible error ${res.status}: ${text || res.statusText}` };
        }

        const data = (await res.json()) as Record<string, unknown>;
        const choices = (data.choices as Array<Record<string, unknown>> | undefined) ?? [];
        const first = choices[0] ?? {};
        const message = (first.message as Record<string, unknown> | undefined) ?? {};
        const output = String(message.content ?? "");
        const usage = (data.usage as Record<string, unknown> | undefined) ?? {};
        return {
          success: true,
          output,
          tokensUsed: Number(usage.total_tokens ?? usage.completion_tokens ?? 0) || undefined,
          actualProvider: "openai-compatible",
          actualModelProvider: inferProviderFromModel(String(data.model ?? request.agent.model ?? "")) ?? "openai",
          actualModel: String(data.model ?? request.agent.model ?? ""),
        };
      } catch (err) {
        return { success: false, error: `openai-compatible dispatch failed: ${(err as Error).message}` };
      } finally {
        clearTimeout(timeout);
      }
    },
    async dispatchStream(request: DispatchRequest, handlers?: DispatchStreamHandlers): Promise<DispatchResult> {
      const res = await this.dispatch(request);
      if (res.success && res.output) handlers?.onChunk?.(res.output);
      if (res.success) handlers?.onDone?.(res);
      else handlers?.onError?.(new Error(res.error ?? "dispatch failed"));
      return res;
    },

    async healthCheck() {
      try {
        const res = await fetch(`${baseUrl}/models`, { method: "GET" });
        return res.ok;
      } catch {
        return false;
      }
    },
  };
}

function buildPrompt(request: DispatchRequest): string {
  const lines: string[] = [];
  lines.push(`# ${request.title}`);
  lines.push("");
  lines.push(request.description);
  if (request.acceptanceCriteria?.length) {
    lines.push("", "Acceptance Criteria:");
    for (const c of request.acceptanceCriteria) lines.push(`- ${c}`);
  }
  if (request.previousNotes) lines.push("", `Previous Notes:\n${request.previousNotes}`);
  if (request.context && Object.keys(request.context).length) {
    lines.push("", "Context:", JSON.stringify(request.context, null, 2));
  }
  return lines.join("\n");
}

function inferProviderFromModel(model: string): string | null {
  const v = model.toLowerCase();
  if (v.includes("gpt") || v.includes("openai")) return "openai";
  if (v.includes("claude") || v.includes("anthropic")) return "anthropic";
  if (v.includes("gemini") || v.includes("google")) return "google";
  if (v.includes("llama") || v.includes("ollama")) return "ollama";
  if (v.includes("mistral")) return "mistral";
  if (v.includes("deepseek")) return "deepseek";
  return null;
}

async function safeText(res: Response): Promise<string> {
  try {
    return await res.text();
  } catch {
    return "";
  }
}
