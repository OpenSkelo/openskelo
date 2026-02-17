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
  context: Record<string, unknown>;
  acceptanceCriteria: string[];
  previousNotes?: string;
  bounceCount: number;
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
}

// ── Provider adapter interface ──

export interface ProviderAdapter {
  name: string;
  type: string;
  dispatch(request: DispatchRequest): Promise<DispatchResult>;
  healthCheck?(): Promise<boolean>;
  cancel?(sessionId: string): Promise<void>;
}

// ── Block Core MVP types ──

export type BlockStep = "NORA_PLAN" | "REI_BUILD" | "MARI_REVIEW" | "DONE";

export type RunContext = Record<string, unknown>;

export interface BlockOutput {
  block: BlockStep;
  iteration: number;
  agent: "nora" | "rei" | "mari";
  output: string;
  artifact_path: string | null;
  artifact_preview: string | null;
  context_snapshot: RunContext;
  timestamp: string;
}

export interface RunStepRecord extends BlockOutput {
  id: string;
  run_id: string;
  step_index: number;
  transition: string;
}

export interface RunModel {
  id: string;
  original_prompt: string;
  current_block: BlockStep;
  iteration: number;
  run_version: number;
  status: "running" | "done";
  artifact_path: string | null;
  artifact_preview: string | null;
  context: RunContext;
  blocks: BlockOutput[];
  created_at: string;
  updated_at: string;
}

export interface RunEvent {
  id: string;
  run_id: string;
  block: BlockStep;
  transition: string;
  result: "pass" | "fail";
  details: Record<string, unknown>;
  created_at: string;
}

export interface RunStepInput {
  reviewApproved?: boolean;
  contextPatch?: RunContext;
  idempotencyKey?: string;
}

export type RunStepResult =
  | {
      ok: true;
      run: RunModel;
      events: RunEvent[];
      deduplicated?: boolean;
    }
  | {
      ok: false;
      error: string;
      status: number;
      code?: "IDEMPOTENCY_KEY_REUSED" | "RUN_STEP_CONFLICT";
      gate?: {
        name: string;
        pass: boolean;
        reason?: string;
        details?: Record<string, unknown>;
      };
    };
