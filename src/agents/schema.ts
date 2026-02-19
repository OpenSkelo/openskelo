import { z } from "zod";

export const ModelConfigSchema = z.object({
  primary: z.string(),
  fallbacks: z.array(z.string()).default([]),
  routing: z.object({
    strategy: z.enum(["cost_optimized", "latency_optimized", "quality_first", "adaptive"]).default("adaptive"),
    adaptive: z.object({
      min_samples: z.number().default(10),
      gate_threshold: z.number().min(0).max(1).default(0.9),
      promote_after: z.number().default(5),
      demote_after: z.number().default(2),
    }).optional(),
  }).default({ strategy: "adaptive" }),
  params: z.object({
    temperature: z.number().min(0).max(2).optional(),
    max_tokens: z.number().positive().optional(),
  }).default({}),
});

export const PermissionsSchema = z.object({
  can_create_agents: z.boolean().default(false),
  can_modify_connections: z.boolean().default(false),
  can_spend_per_run: z.number().positive().default(0.5),
  can_spend_per_day: z.number().positive().default(2.0),
  max_delegation_depth: z.number().min(0).default(0),
});

export const PortSchema = z.object({
  name: z.string(),
  type: z.enum(["json", "string", "number"]).default("string"),
  required: z.boolean().default(false),
  default: z.unknown().optional(),
});

export const GateCheckSchema = z.object({
  type: z.enum(["port_not_empty", "json_schema", "expression", "llm_review", "word_count", "regex"]),
  port: z.string().optional(),
  schema: z.record(z.string(), z.unknown()).optional(),
  expression: z.string().optional(),
  criteria: z.array(z.string()).optional(),
  pattern: z.string().optional(),
  min: z.number().optional(),
  max: z.number().optional(),
});

export const GateSchema = z.object({
  name: z.string(),
  check: GateCheckSchema,
  error: z.string().optional(),
});

export const GateFailActionSchema = z.object({
  gate: z.string(),
  action: z.enum(["retry", "reroute", "abort", "skip"]).default("retry"),
  max: z.number().default(2),
  feedback: z.string().optional(),
  reroute_to: z.string().optional(),
});

export const TriggerSchema = z.object({
  type: z.enum(["cron", "on_demand", "webhook", "watch", "event"]),
  schedule: z.string().optional(),
  enabled: z.boolean().default(true),
  inputs: z.record(z.string(), z.unknown()).optional(),
});

export const ConnectionOutputSchema = z.object({
  agent: z.string(),
  mapping: z.record(z.string(), z.string()),
});

export const CacheSchema = z.object({
  enabled: z.boolean().default(false),
  strategy: z.enum(["input_hash"]).default("input_hash"),
  ttl_seconds: z.number().default(3600),
  invalidate_on: z.array(z.string()).default([]),
});

export const AgentYamlSchema = z.object({
  version: z.string().default("0.1"),
  id: z.string(),
  name: z.string(),
  description: z.string().optional(),
  created_by: z.string().optional(),
  created_at: z.string().optional(),
  runtime: z.enum(["direct", "deterministic"]).default("direct"),
  model: ModelConfigSchema,
  autonomy: z.enum(["read_only", "draft", "write", "admin"]).default("read_only"),
  permissions: PermissionsSchema.default({
    can_create_agents: false,
    can_modify_connections: false,
    can_spend_per_run: 0.5,
    can_spend_per_day: 2.0,
    max_delegation_depth: 0,
  }),
  inputs: z.array(PortSchema).default([]),
  outputs: z.array(PortSchema).default([{ name: "default", type: "string", required: false }]),
  gates: z.object({
    pre: z.array(GateSchema).default([]),
    post: z.array(GateSchema).default([]),
  }).default({ pre: [], post: [] }),
  on_gate_fail: z.array(GateFailActionSchema).default([]),
  retry: z.object({
    max_attempts: z.number().default(3),
    backoff_ms: z.number().default(2000),
  }).default({ max_attempts: 3, backoff_ms: 2000 }),
  timeout_ms: z.number().default(30000),
  cache: CacheSchema.default({ enabled: false, strategy: "input_hash", ttl_seconds: 3600, invalidate_on: [] }),
  triggers: z.array(TriggerSchema).default([{ type: "on_demand", enabled: true }]),
  connections: z.object({
    outputs_to: z.array(ConnectionOutputSchema).default([]),
  }).default({ outputs_to: [] }),
  workspace: z.object({
    read: z.array(z.string()).default([]),
    write: z.array(z.string()).default([]),
  }).default({ read: [], write: [] }),
  depends_on: z.array(z.string()).default([]),
});

export type AgentYaml = z.infer<typeof AgentYamlSchema>;
