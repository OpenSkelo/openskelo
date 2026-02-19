import { calculateCost } from "./cost-calculator.js";
import type {
  LLMProvider,
  Message,
  ToolCall,
  ToolDefinition,
  ToolResult,
} from "./providers/types.js";

export interface DirectRuntimeConfig {
  providers: Map<string, LLMProvider>;
  modelToProvider: Map<string, string>;
}

export interface DirectDispatchRequest {
  agentId: string;
  system: string;
  userMessage: string;
  inputs: Record<string, unknown>;
  tools?: ToolDefinition[];
  toolExecutor?: ToolExecutor;
  model: string;
  params?: {
    temperature?: number;
    maxTokens?: number;
  };
  timeoutMs?: number;
}

export interface DirectDispatchResult {
  outputs: Record<string, unknown>;
  content: string;
  tokens: { input: number; output: number };
  cost: number;
  durationMs: number;
  modelUsed: string;
  toolCalls: ToolCallRecord[];
}

export interface ToolCallRecord {
  name: string;
  input: Record<string, unknown>;
  output: string;
  isError: boolean;
  durationMs: number;
}

export type ToolExecutor = (call: ToolCall) => Promise<ToolResult>;

export class DirectRuntime {
  private config: DirectRuntimeConfig;

  constructor(config: DirectRuntimeConfig) {
    this.config = config;
  }

  async dispatch(request: DirectDispatchRequest): Promise<DirectDispatchResult> {
    const start = Date.now();
    const providerName = this.config.modelToProvider.get(request.model);
    if (!providerName) {
      throw new Error(`No provider configured for model: ${request.model}`);
    }

    const provider = this.config.providers.get(providerName);
    if (!provider) {
      throw new Error(`Provider not found: ${providerName}`);
    }

    const messages: Message[] = [
      { role: "system", content: request.system },
      { role: "user", content: request.userMessage },
    ];

    if (!request.tools?.length || !request.toolExecutor) {
      const response = await provider.complete({
        model: request.model,
        messages,
        maxTokens: request.params?.maxTokens,
        temperature: request.params?.temperature,
        timeoutMs: request.timeoutMs,
      });

      return {
        outputs: { default: response.content },
        content: response.content,
        tokens: {
          input: response.usage.inputTokens,
          output: response.usage.outputTokens,
        },
        cost: calculateCost(request.model, response.usage),
        durationMs: Date.now() - start,
        modelUsed: response.model,
        toolCalls: [],
      };
    }

    return this.dispatchWithTools(provider, request, messages, start);
  }

  private async dispatchWithTools(
    provider: LLMProvider,
    request: DirectDispatchRequest,
    messages: Message[],
    startedAt: number
  ): Promise<DirectDispatchResult> {
    const toolCallRecords: ToolCallRecord[] = [];
    let totalInputTokens = 0;
    let totalOutputTokens = 0;
    let iterations = 0;
    const maxIterations = 10;

    while (iterations < maxIterations) {
      iterations += 1;

      const response = await provider.complete({
        model: request.model,
        messages,
        tools: request.tools,
        maxTokens: request.params?.maxTokens,
        temperature: request.params?.temperature,
        timeoutMs: request.timeoutMs,
      });

      totalInputTokens += response.usage.inputTokens;
      totalOutputTokens += response.usage.outputTokens;

      if (response.stopReason !== "tool_use" || !response.toolCalls?.length) {
        return {
          outputs: { default: response.content },
          content: response.content,
          tokens: { input: totalInputTokens, output: totalOutputTokens },
          cost: calculateCost(request.model, {
            inputTokens: totalInputTokens,
            outputTokens: totalOutputTokens,
          }),
          durationMs: Date.now() - startedAt,
          modelUsed: response.model,
          toolCalls: toolCallRecords,
        };
      }

      messages.push({
        role: "assistant",
        content: response.content ?? "",
        toolCalls: response.toolCalls,
      });

      for (const call of response.toolCalls) {
        const toolStart = Date.now();
        try {
          const result = await request.toolExecutor!(call);
          toolCallRecords.push({
            name: call.name,
            input: call.input,
            output: result.content,
            isError: !!result.isError,
            durationMs: Date.now() - toolStart,
          });

          messages.push({
            role: "tool",
            content: result.content,
            toolUseId: call.id,
          });
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          toolCallRecords.push({
            name: call.name,
            input: call.input,
            output: `Error: ${message}`,
            isError: true,
            durationMs: Date.now() - toolStart,
          });
          messages.push({ role: "tool", content: `Error executing tool: ${message}`, toolUseId: call.id });
        }
      }
    }

    throw new Error(`Tool-use loop exceeded ${maxIterations} iterations for agent ${request.agentId}`);
  }
}
