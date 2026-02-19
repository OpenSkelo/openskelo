export interface LLMProvider {
  name: string;
  complete(request: CompletionRequest): Promise<CompletionResponse>;
  supportsStreaming(): boolean;
}

export interface CompletionRequest {
  model: string;
  messages: Message[];
  tools?: ToolDefinition[];
  maxTokens?: number;
  temperature?: number;
  timeoutMs?: number;
}

export interface CompletionResponse {
  content: string;
  stopReason: "end_turn" | "tool_use" | "max_tokens";
  toolCalls?: ToolCall[];
  usage: {
    inputTokens: number;
    outputTokens: number;
  };
  model: string;
  durationMs: number;
}

export interface Message {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  toolUseId?: string;
  toolCalls?: ToolCall[];
}

export interface ToolCall {
  id: string;
  name: string;
  input: Record<string, unknown>;
}

export interface ToolResult {
  toolUseId: string;
  content: string;
  isError?: boolean;
}

export interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}
