export interface BlockGate {
  name: string;
  check: BlockGateCheck;
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

export interface GateResult {
  name: string;
  passed: boolean;
  reason?: string;
  audit?: Record<string, unknown>;
}
