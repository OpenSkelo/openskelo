import type { DispatchRequest, DispatchResult, DispatchStreamHandlers, ProviderAdapter } from "../types.js";

export interface OllamaProviderOpts {
  name: string;
  baseUrl?: string;
  timeoutMs?: number;
}

export function createOllamaProvider(opts: OllamaProviderOpts): ProviderAdapter {
  const baseUrl = (opts.baseUrl ?? "http://localhost:11434").replace(/\/$/, "");
  const timeoutMs = opts.timeoutMs ?? 120_000;

  return {
    name: opts.name,
    type: "ollama",
    async dispatch(request: DispatchRequest): Promise<DispatchResult> {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const messages: Array<{ role: string; content: string }> = [];
        if (request.system && request.system.trim()) {
          messages.push({ role: "system", content: request.system });
        }
        messages.push({ role: "user", content: buildPrompt(request) });

        const basePayload: Record<string, unknown> = {
          model: request.agent.model || "llama3.1",
          messages,
          stream: false,
        };

        const payload = {
          ...basePayload,
          ...(request.modelParams ?? {}),
        };

        const res = await fetch(`${baseUrl}/api/chat`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
          signal: request.abortSignal ?? controller.signal,
        });

        if (!res.ok) {
          const text = await safeText(res);
          return { success: false, error: `ollama error ${res.status}: ${text || res.statusText}` };
        }

        const data = (await res.json()) as Record<string, unknown>;
        const msg = (data.message as Record<string, unknown> | undefined) ?? {};
        const output = String(msg.content ?? "");

        // Ollama returns token counts in eval_count/prompt_eval_count for /api/chat responses.
        const tokensIn = Number(data.prompt_eval_count ?? 0);
        const tokensOut = Number(data.eval_count ?? 0);
        return {
          success: true,
          output,
          tokensUsed: (tokensIn + tokensOut) || undefined,
          actualProvider: "ollama",
          actualModelProvider: "ollama",
          actualModel: String(data.model ?? request.agent.model ?? ""),
        };
      } catch (err) {
        return { success: false, error: `ollama dispatch failed: ${(err as Error).message}` };
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
        const res = await fetch(`${baseUrl}/api/tags`, { method: "GET" });
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

async function safeText(res: Response): Promise<string> {
  try {
    return await res.text();
  } catch {
    return "";
  }
}
