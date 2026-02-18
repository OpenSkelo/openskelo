// ── Config types (parsed from skelo.yaml) ──

export interface SkeloConfig {
  name: string;
  providers: Provider[];
  agents: Record<string, Agent>;
  pipelines: Record<string, Pipeline>;
  gates: Gate[];
  storage: "sqlite" | "postgres" | "turso";
  dashboard: {
    enabled: boolean;
    port: number;
  };
}

export interface Provider {
  name: string;
  type: "ollama" | "openai" | "anthropic" | "openclaw" | "http";
  url?: string;
  env?: string; // environment variable name for API key
  config?: Record<string, unknown>;
}

export interface Agent {
  role: "worker" | "reviewer" | "manager" | "specialist";
  capabilities: string[];
  provider: string;
  model: string;
  max_concurrent: number;
  config?: Record<string, unknown>;
}

export interface Pipeline {
  stages: Stage[];
}

export interface Stage {
  name: string;
  transitions?: string[];
  route?: RouteRule;
}

export interface RouteRule {
  role: Agent["role"];
  capability?: string;
  specific?: string; // route to specific agent ID
}

export interface Gate {
  name: string;
  on: GateTrigger;
  check: GateCheck;
  error: string;
  bypass?: string[]; // roles that can bypass
}

export interface GateTrigger {
  from?: string;
  to: string;
  pipeline?: string; // apply to specific pipeline only
}

export type GateCheck =
  | { type: "not_empty"; field: string }
  | { type: "contains"; field: string; values: string[] }
  | { type: "matches"; field: string; pattern: string }
  | { type: "min_length"; field: string; min: number }
  | { type: "max_value"; field: string; max: number }
  | { type: "valid_json"; field: string }
  | { type: "valid_url"; field: string }
  | { type: "shell"; command: string };

// ── Runtime types ──

export interface Task {
  id: string;
  pipeline: string;
  title: string;
  description: string;
  status: string;
  assigned: string;
  notes: string;
  metadata: Record<string, unknown>;
  bounce_count: number;
  priority: string;
  created_at: string;
  updated_at: string;
}

export interface AuditEntry {
  id: string;
  task_id: string;
  from_status: string | null;
  to_status: string;
  agent: string;
  gates: GateResult[];
  notes: string;
  created_at: string;
}

export interface GateResult {
  name: string;
  result: "pass" | "fail";
  reason?: string;
}

export interface DispatchRequest {
  taskId: string;
  pipeline: string;
  title: string;
  description: string;
  /** Optional system message/instruction for chat-style providers */
  system?: string;
  context: Record<string, unknown>;
  acceptanceCriteria: string[];
  previousNotes?: string;
  bounceCount: number;
  outputSchema?: Record<string, unknown>;
  /** Provider-specific model params passthrough (temperature/top_p/max_tokens/etc.) */
  modelParams?: Record<string, unknown>;
  abortSignal?: AbortSignal;
  isCancelled?: () => boolean;
  agent: {
    id: string;
    role: string;
    model: string;
  };
}

export interface DispatchResult {
  success: boolean;
  sessionId?: string;
  output?: string;
  error?: string;
  tokensUsed?: number;
  actualAgentId?: string;
  actualModel?: string;
  /** Transport used to execute the block (e.g., openclaw) */
  actualProvider?: string;
  /** Billable model provider when known (e.g., openai, anthropic) */
  actualModelProvider?: string;
  repairAttempted?: boolean;
  repairSucceeded?: boolean;
}

export interface DispatchStreamHandlers {
  onChunk?: (chunk: string) => void;
  onDone?: (result: DispatchResult) => void;
  onError?: (error: Error) => void;
}

// ── Provider adapter interface ──

export interface ProviderAdapter {
  name: string;
  type: string;
  dispatch(request: DispatchRequest): Promise<DispatchResult>;
  /** Optional streaming interface. Providers may emit chunks then return final result. */
  dispatchStream?(request: DispatchRequest, handlers?: DispatchStreamHandlers): Promise<DispatchResult>;
  healthCheck?(): Promise<boolean>;
  cancel?(sessionId: string): Promise<void>;
}

// Legacy run-loop runtime types removed. Use DAG runtime types from core/block.ts instead.
