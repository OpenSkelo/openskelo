/**
 * Block type surface extracted from block.ts
 */

export interface GateComposition {
  pre?: "all" | "any";
  post?: "all" | "any";
}

export type BlockMode = "ai" | "deterministic" | "approval";

export interface DeterministicSpec {
  handler: string;
  config?: Record<string, unknown>;
}

export interface BlockDef {
  /** Unique block ID within the DAG (e.g., "build", "review", "deploy") */
  id: string;

  /** Human-readable name */
  name: string;

  /** What this block needs to run — keys are port names, values are type descriptors */
  inputs: Record<string, PortDef>;

  /** What this block produces — keys are port names, values are type descriptors */
  outputs: Record<string, PortDef>;

  /** Execution mode */
  mode?: BlockMode;

  /** Agent routing: which agent handles this block */
  agent: AgentRef;

  /** Deterministic handler config (required when mode=deterministic) */
  deterministic?: DeterministicSpec;

  /** Pre-execution gates — all must pass before block runs */
  pre_gates: BlockGate[];

  /** Post-execution gates — all must pass after block runs (before outputs propagate) */
  post_gates: BlockGate[];

  /** Generic gate-failure routing/bounce rules */
  on_gate_fail?: GateFailRule[];

  /** Gate composition behavior (default pre=all, post=all) */
  gate_composition?: GateComposition;

  /** Optional human approval gate before this block executes */
  approval?: ApprovalPolicy;

  /** Retry policy on failure */
  retry: RetryPolicy;

  /** Optional timeout in ms */
  timeout_ms?: number;

  /** Whether output contract enforcement is strict for this block (default: true) */
  strict_output?: boolean;

  /** Additional contract-repair attempts after first parse (default: 1) */
  contract_repair_attempts?: number;

  /** Arbitrary user metadata */
  metadata?: Record<string, unknown>;
}

export interface PortDef {
  /** Port type: string, number, boolean, json, file, artifact */
  type: "string" | "number" | "boolean" | "json" | "file" | "artifact";

  /** Human description of what this port carries */
  description?: string;

  /** Whether this port is required (default: true) */
  required?: boolean;

  /** Default value if not wired */
  default?: unknown;
}

export interface AgentRef {
  /** Route by role */
  role?: string;

  /** Route by capability */
  capability?: string;

  /** Route to specific agent ID */
  specific?: string;

  /** Optional model parameters passed through to provider adapters */
  model_params?: Record<string, unknown>;
}

export interface BlockGate {
  /** Gate name for audit trail */
  name: string;

  /** The check to perform */
  check: BlockGateCheck;

  /** Error message on failure */
  error: string;
}

export type BlockGateCheck =
  | { type: "port_not_empty"; port: string }
  | { type: "port_matches"; port: string; pattern: string }
  | { type: "port_min_length"; port: string; min: number }
  | { type: "port_type"; port: string; expected: string }
  | { type: "json_schema"; port: string; schema: Record<string, unknown> }
  | { type: "http"; url: string; method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE"; expect_status?: number; timeout_ms?: number }
  | { type: "semantic_review"; port: string; keywords: string[]; min_matches?: number }
  | { type: "llm_review"; port: string; criteria: string[]; provider?: string; model?: string; pass_threshold?: number; timeout_ms?: number; system_prompt?: string }
  | { type: "diff"; left: string; right: string; mode?: "equal" | "not_equal" }
  | { type: "cost"; max: number; port?: string }
  | { type: "latency"; max_ms: number; port?: string }
  | { type: "shell"; command: string }
  | { type: "expr"; expression: string };

export interface RetryPolicy {
  /** Max retry attempts (0 = no retries) */
  max_attempts: number;

  /** Backoff strategy */
  backoff: "none" | "linear" | "exponential";

  /** Base delay in ms between retries */
  delay_ms: number;

  /** Max delay cap in ms */
  max_delay_ms?: number;
}

export interface GateFailRule {
  /** Gate name to match (e.g., "review-approved") */
  when_gate: string;
  /** Reroute target block id to resume from */
  route_to: string;
  /** Additional blocks to reset to pending (besides current block) */
  reset_blocks?: string[];
  /** Max bounce count before hard fail */
  max_bounces: number;
  /** Message shown in logs/events */
  reason?: string;
  /** Optional context payload mapping when bouncing (e.g. gate_verdicts) */
  feedback_from?: "gate_verdicts";
}

export interface ApprovalPolicy {
  required: boolean;
  prompt?: string;
  approver?: string;
  timeout_sec?: number;
}

// ── DAG Definition (from YAML config) ──

export interface DAGDef {
  /** DAG name */
  name: string;

  /** All blocks in this DAG */
  blocks: BlockDef[];

  /** Edges: wiring block outputs to block inputs */
  edges: Edge[];

  /** Entry points: blocks with no upstream dependencies */
  entrypoints?: string[];

  /** Terminal blocks: blocks whose completion means DAG is done */
  terminals?: string[];
}

export interface Edge {
  /** Source block ID */
  from: string;

  /** Source output port name */
  output: string;

  /** Target block ID */
  to: string;

  /** Target input port name */
  input: string;

  /** Optional transform expression applied to the value in transit */
  transform?: string;
}

// ── Runtime Types ──

export type BlockStatus =
  | "pending"     // waiting for inputs
  | "ready"       // all inputs satisfied, pre-gates not yet checked
  | "gated"       // pre-gate failed, waiting for resolution
  | "running"     // executing
  | "completed"   // finished successfully, outputs available
  | "failed"      // execution failed
  | "retrying"    // failed but retrying
  | "skipped";    // skipped (optional input path not taken)

export interface BlockInstance {
  /** Unique instance ID for this execution */
  instance_id: string;

  /** Reference to the block definition */
  block_id: string;

  /** Which DAG run this belongs to */
  run_id: string;

  /** Current status */
  status: BlockStatus;

  /** Resolved input values (port name → value) */
  inputs: Record<string, unknown>;

  /** Produced output values (port name → value) */
  outputs: Record<string, unknown>;

  /** Pre-gate results */
  pre_gate_results: GateResult[];

  /** Post-gate results */
  post_gate_results: GateResult[];

  /** Execution metadata */
  execution: BlockExecution | null;

  /** Assigned worker for this block run (set when scheduler routes it) */
  active_agent_id?: string;
  active_model?: string;
  active_provider?: string;
  active_schema_guided?: boolean;

  /** Retry state */
  retry_state: RetryState;

  /** Timestamps */
  created_at: string;
  started_at: string | null;
  completed_at: string | null;
}

export interface BlockExecution {
  /** Agent that executed this block */
  agent_id: string;

  /** Billable model provider used (e.g., openai, anthropic). Backward-compatible field. */
  provider: string;

  /** Transport used to execute this block (e.g., openclaw adapter) */
  transport_provider?: string;

  /** Model used */
  model: string;

  /** Raw agent output (for audit) */
  raw_output: string;

  /** Tokens consumed */
  tokens_in: number;
  tokens_out: number;

  /** Execution duration in ms */
  duration_ms: number;

  /** Error if failed */
  error?: string;
}

export interface GateResult {
  name: string;
  passed: boolean;
  reason?: string;
  audit?: Record<string, unknown>;
}

export interface RetryState {
  attempt: number;
  max_attempts: number;
  next_retry_at: string | null;
  last_error: string | null;
}

// ── DAG Run ──

export interface DAGRun {
  /** Unique run ID */
  id: string;

  /** DAG definition name */
  dag_name: string;

  /** Overall status */
  status: "pending" | "running" | "paused_approval" | "completed" | "failed" | "cancelled" | "iterated";

  /** All block instances in this run */
  blocks: Record<string, BlockInstance>;

  /** Global context (user-provided initial inputs) */
  context: Record<string, unknown>;

  /** Timestamps */
  created_at: string;
  updated_at: string;
}
