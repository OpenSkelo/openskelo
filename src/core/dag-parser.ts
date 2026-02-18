import type {
  AgentRef,
  ApprovalPolicy,
  BlockDef,
  BlockGate,
  BlockGateCheck,
  BlockMode,
  DAGDef,
  DeterministicSpec,
  Edge,
  GateComposition,
  GateFailRule,
  PortDef,
  RetryPolicy,
} from "./block-types.js";
import { isPotentiallyUnsafeRegex, suggestClosest, topoSort } from "./block-helpers.js";

export function parseDAG(raw: Record<string, unknown>): DAGDef {
  const name = raw.name as string;
  if (!name) throw new Error("DAG requires a name");

  const rawBlocks = raw.blocks as Record<string, unknown>[];
  if (!Array.isArray(rawBlocks) || rawBlocks.length === 0) {
    throw new Error("DAG requires at least one block");
  }

  const blocks = rawBlocks.map(parseBlockDef);
  const edges = ((raw.edges ?? []) as Record<string, unknown>[]).map(parseEdge);

  // Validate edges reference real blocks and ports
  const blockMap = new Map(blocks.map((b) => [b.id, b]));
  const allBlockIds = blocks.map((b) => b.id);
  for (const edge of edges) {
    const fromBlock = blockMap.get(edge.from);
    if (!fromBlock) {
      const hint = suggestClosest(edge.from, allBlockIds);
      throw new Error(`Edge references unknown block: ${edge.from}${hint ? ` (did you mean '${hint}'?)` : ""}`);
    }
    if (!fromBlock.outputs[edge.output]) {
      const hint = suggestClosest(edge.output, Object.keys(fromBlock.outputs));
      throw new Error(`Edge references unknown output port: ${edge.from}.${edge.output}${hint ? ` (did you mean '${hint}'?)` : ""}`);
    }

    const toBlock = blockMap.get(edge.to);
    if (!toBlock) {
      const hint = suggestClosest(edge.to, allBlockIds);
      throw new Error(`Edge references unknown block: ${edge.to}${hint ? ` (did you mean '${hint}'?)` : ""}`);
    }
    if (!toBlock.inputs[edge.input]) {
      const hint = suggestClosest(edge.input, Object.keys(toBlock.inputs));
      throw new Error(`Edge references unknown input port: ${edge.to}.${edge.input}${hint ? ` (did you mean '${hint}'?)` : ""}`);
    }
  }

  // Validate on_gate_fail references
  for (const block of blocks) {
    const availableGates = new Set([
      ...(block.pre_gates ?? []).map((g) => g.name),
      ...(block.post_gates ?? []).map((g) => g.name),
    ]);

    for (const rule of block.on_gate_fail ?? []) {
      if (!blockMap.has(rule.route_to)) {
        const hint = suggestClosest(rule.route_to, allBlockIds);
        throw new Error(
          `Block '${block.id}' on_gate_fail routes to unknown block '${rule.route_to}'` +
          (hint ? ` (did you mean '${hint}'?)` : "")
        );
      }

      if (!availableGates.has(rule.when_gate)) {
        const gateNames = Array.from(availableGates);
        const hint = suggestClosest(rule.when_gate, gateNames);
        throw new Error(
          `Block '${block.id}' on_gate_fail references unknown gate '${rule.when_gate}'` +
          (hint ? ` (did you mean '${hint}'?)` : "")
        );
      }
    }
  }

  // Compute entrypoints (blocks with no incoming edges)
  const hasIncoming = new Set(edges.map((e) => e.to));
  const entrypoints = (raw.entrypoints as string[] | undefined)
    ?? blocks.filter((b) => !hasIncoming.has(b.id)).map((b) => b.id);

  // Compute terminals (blocks with no outgoing edges)
  const hasOutgoing = new Set(edges.map((e) => e.from));
  const terminals = (raw.terminals as string[] | undefined)
    ?? blocks.filter((b) => !hasOutgoing.has(b.id)).map((b) => b.id);

  // Cycle detection
  detectCycles(blocks, edges);

  return { name, blocks, edges, entrypoints, terminals };
}

function parseBlockDef(raw: Record<string, unknown>): BlockDef {
  const id = raw.id as string;
  if (!id) throw new Error("Block requires an id");

  const inputs: Record<string, PortDef> = {};
  if (raw.inputs && typeof raw.inputs === "object") {
    for (const [key, val] of Object.entries(raw.inputs as Record<string, unknown>)) {
      inputs[key] = parsePortDef(val, `${id}.inputs.${key}`);
    }
  }

  const outputs: Record<string, PortDef> = {};
  if (raw.outputs && typeof raw.outputs === "object") {
    for (const [key, val] of Object.entries(raw.outputs as Record<string, unknown>)) {
      outputs[key] = parsePortDef(val, `${id}.outputs.${key}`);
    }
  }

  const mode = parseBlockMode(raw.mode, id);
  const deterministic = parseDeterministicSpec(raw.deterministic, id, mode);

  return {
    id,
    name: (raw.name as string) ?? id,
    mode,
    inputs,
    outputs,
    agent: parseAgentRef(raw.agent as Record<string, unknown> | undefined),
    deterministic,
    pre_gates: parseBlockGates(raw.pre_gates),
    post_gates: parseBlockGates(raw.post_gates),
    on_gate_fail: parseGateFailRules(raw.on_gate_fail, id),
    gate_composition: parseGateComposition(raw.gate_composition),
    approval: parseApprovalPolicy(raw.approval),
    retry: parseRetryPolicy(raw.retry),
    timeout_ms: raw.timeout_ms as number | undefined,
    strict_output: raw.strict_output === false ? false : true,
    contract_repair_attempts: Number(raw.contract_repair_attempts ?? 1),
    metadata: raw.metadata as Record<string, unknown> | undefined,
  };
}

function parsePortDef(raw: unknown, path: string): PortDef {
  const t = typeof raw;
  if (t === "string") {
    const type = raw as PortDef["type"];
    if (!["string", "number", "boolean", "json", "file", "artifact"].includes(type)) {
      throw new Error(`Invalid port type at ${path}: ${String(raw)}`);
    }
    return { type, required: true };
  }
  if (raw && t === "object") {
    const obj = raw as Record<string, unknown>;
    const type = obj.type as PortDef["type"];
    if (!["string", "number", "boolean", "json", "file", "artifact"].includes(type)) {
      throw new Error(`Invalid port type at ${path}: ${String(obj.type)}`);
    }
    return {
      type,
      description: obj.description as string | undefined,
      required: obj.required === false ? false : true,
      default: obj.default,
    };
  }
  throw new Error(`Invalid port definition at ${path}`);
}

function parseAgentRef(raw: Record<string, unknown> | undefined): AgentRef {
  if (!raw) return {};
  return {
    role: raw.role as string | undefined,
    capability: raw.capability as string | undefined,
    specific: raw.specific as string | undefined,
    model_params: raw.model_params as Record<string, unknown> | undefined,
  };
}

function parseBlockGates(raw: unknown): BlockGate[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((g, idx) => {
    if (!g || typeof g !== "object") throw new Error(`Invalid gate at index ${idx}`);
    const obj = g as Record<string, unknown>;
    const name = obj.name as string;
    const error = obj.error as string;
    const check = parseBlockGateCheck(obj.check, `gate[${idx}].check`);
    if (!name) throw new Error(`Gate missing name at index ${idx}`);
    if (!error) throw new Error(`Gate missing error at index ${idx}`);
    return { name, check, error };
  });
}

function parseBlockMode(raw: unknown, blockId: string): BlockMode {
  const mode = String(raw ?? "ai").trim();
  if (mode !== "ai" && mode !== "deterministic" && mode !== "approval") {
    throw new Error(`Invalid mode for block '${blockId}': ${mode}. Allowed: ai|deterministic|approval`);
  }
  return mode as BlockMode;
}

function parseDeterministicSpec(raw: unknown, blockId: string, mode: BlockMode): DeterministicSpec | undefined {
  if (mode !== "deterministic") return undefined;
  if (!raw || typeof raw !== "object") {
    throw new Error(`Block '${blockId}' mode=deterministic requires 'deterministic' object with handler`);
  }
  const obj = raw as Record<string, unknown>;
  const handler = typeof obj.handler === "string" ? obj.handler.trim() : "";
  if (!handler) {
    throw new Error(`Block '${blockId}' mode=deterministic requires deterministic.handler`);
  }
  return {
    handler,
    config: (obj.config && typeof obj.config === "object") ? (obj.config as Record<string, unknown>) : undefined,
  };
}

function parseBlockGateCheck(raw: unknown, path: string): BlockGateCheck {
  if (!raw || typeof raw !== "object") throw new Error(`Invalid ${path}: expected object`);
  const obj = raw as Record<string, unknown>;
  const type = obj.type as BlockGateCheck["type"];
  if (!type) throw new Error(`Invalid ${path}: missing gate check type`);

  switch (type) {
    case "port_not_empty": {
      if (typeof obj.port !== "string") throw new Error(`Invalid ${path}: port_not_empty requires string port`);
      return { type, port: obj.port };
    }
    case "port_matches": {
      if (typeof obj.port !== "string" || typeof obj.pattern !== "string") {
        throw new Error(`Invalid ${path}: port_matches requires string port + pattern`);
      }
      try {
        // syntax-check regex upfront to fail at parse-time
        // eslint-disable-next-line no-new
        new RegExp(obj.pattern);
      } catch {
        throw new Error(`Invalid ${path}: pattern must be a valid regex`);
      }
      if (isPotentiallyUnsafeRegex(obj.pattern)) {
        throw new Error(`Invalid ${path}: regex rejected by ReDoS safety guard`);
      }
      return { type, port: obj.port, pattern: obj.pattern };
    }
    case "port_min_length": {
      const min = Number(obj.min);
      if (typeof obj.port !== "string" || !Number.isFinite(min) || min < 0) {
        throw new Error(`Invalid ${path}: port_min_length requires string port + numeric min >= 0`);
      }
      return { type, port: obj.port, min };
    }
    case "port_type": {
      if (typeof obj.port !== "string" || typeof obj.expected !== "string") {
        throw new Error(`Invalid ${path}: port_type requires string port + expected`);
      }
      return { type, port: obj.port, expected: obj.expected };
    }
    case "json_schema": {
      if (typeof obj.port !== "string" || !obj.schema || typeof obj.schema !== "object") {
        throw new Error(`Invalid ${path}: json_schema requires string port + schema object`);
      }
      return { type, port: obj.port, schema: obj.schema as Record<string, unknown> };
    }
    case "http": {
      if (typeof obj.url !== "string" || !obj.url.trim()) {
        throw new Error(`Invalid ${path}: http requires non-empty url`);
      }
      const timeout = obj.timeout_ms == null ? undefined : Number(obj.timeout_ms);
      if (timeout != null && (!Number.isFinite(timeout) || timeout <= 0)) {
        throw new Error(`Invalid ${path}: http timeout_ms must be > 0`);
      }
      const expectStatus = obj.expect_status == null ? undefined : Number(obj.expect_status);
      if (expectStatus != null && (!Number.isFinite(expectStatus) || expectStatus < 100 || expectStatus > 599)) {
        throw new Error(`Invalid ${path}: http expect_status must be a valid HTTP status`);
      }
      return {
        type,
        url: obj.url,
        method: (obj.method as "GET" | "POST" | "PUT" | "PATCH" | "DELETE" | undefined) ?? "GET",
        expect_status: expectStatus,
        timeout_ms: timeout,
      };
    }
    case "semantic_review": {
      if (typeof obj.port !== "string" || !Array.isArray(obj.keywords) || obj.keywords.length === 0) {
        throw new Error(`Invalid ${path}: semantic_review requires string port + non-empty keywords[]`);
      }
      const keywords = obj.keywords.map(String).filter(Boolean);
      const minMatches = obj.min_matches == null ? undefined : Number(obj.min_matches);
      if (minMatches != null && (!Number.isFinite(minMatches) || minMatches < 1)) {
        throw new Error(`Invalid ${path}: semantic_review min_matches must be >= 1`);
      }
      return { type, port: obj.port, keywords, min_matches: minMatches };
    }
    case "llm_review": {
      if (typeof obj.port !== "string" || !obj.port.trim()) {
        throw new Error(`Invalid ${path}: llm_review requires non-empty 'port'`);
      }
      const criteriaRaw = Array.isArray(obj.criteria) ? obj.criteria : [];
      if (criteriaRaw.length === 0) {
        throw new Error(`Invalid ${path}: llm_review requires non-empty criteria[]`);
      }
      const criteria = criteriaRaw.map((v) => String(v).trim()).filter(Boolean);
      if (criteria.length === 0) {
        throw new Error(`Invalid ${path}: llm_review criteria[] must contain non-empty strings`);
      }
      const passThreshold = obj.pass_threshold == null ? 1 : Number(obj.pass_threshold);
      if (!Number.isFinite(passThreshold) || passThreshold <= 0 || passThreshold > 1) {
        throw new Error(`Invalid ${path}: llm_review pass_threshold must be between 0 and 1`);
      }
      const timeoutMs = obj.timeout_ms == null ? 15000 : Number(obj.timeout_ms);
      if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
        throw new Error(`Invalid ${path}: llm_review timeout_ms must be > 0`);
      }
      const provider = typeof obj.provider === "string" && obj.provider.trim() ? obj.provider : undefined;
      const model = typeof obj.model === "string" && obj.model.trim() ? obj.model : undefined;
      if (!provider) {
        throw new Error(`Invalid ${path}: llm_review requires non-empty 'provider'`);
      }
      if (!model) {
        throw new Error(`Invalid ${path}: llm_review requires non-empty 'model'`);
      }
      return {
        type,
        port: obj.port,
        criteria,
        provider,
        model,
        pass_threshold: passThreshold,
        timeout_ms: timeoutMs,
        system_prompt: typeof obj.system_prompt === "string" && obj.system_prompt.trim() ? obj.system_prompt : undefined,
      };
    }
    case "diff": {
      if (typeof obj.left !== "string" || typeof obj.right !== "string") {
        throw new Error(`Invalid ${path}: diff requires string left + right ports`);
      }
      const mode = (obj.mode as "equal" | "not_equal" | undefined) ?? "equal";
      return { type, left: obj.left, right: obj.right, mode };
    }
    case "cost": {
      const max = Number(obj.max);
      if (!Number.isFinite(max) || max < 0) {
        throw new Error(`Invalid ${path}: cost requires numeric max >= 0`);
      }
      const port = typeof obj.port === "string" && obj.port.trim() ? obj.port : undefined;
      return { type, max, port };
    }
    case "latency": {
      const maxMs = Number(obj.max_ms);
      if (!Number.isFinite(maxMs) || maxMs < 0) {
        throw new Error(`Invalid ${path}: latency requires numeric max_ms >= 0`);
      }
      const port = typeof obj.port === "string" && obj.port.trim() ? obj.port : undefined;
      return { type, max_ms: maxMs, port };
    }
    case "shell": {
      if (typeof obj.command !== "string" || !obj.command.trim()) {
        throw new Error(`Invalid ${path}: shell requires non-empty 'command'`);
      }
      return { type, command: obj.command };
    }
    case "expr": {
      if (typeof obj.expression !== "string" || !obj.expression.trim()) {
        throw new Error(`Invalid ${path}: expr requires non-empty 'expression'`);
      }
      return { type, expression: obj.expression };
    }
    default:
      throw new Error(`Invalid ${path}: unknown gate check type '${type}'`);
  }
}

function parseGateComposition(raw: unknown): GateComposition | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const obj = raw as Record<string, unknown>;
  const pre = obj.pre === "any" ? "any" : (obj.pre === "all" ? "all" : undefined);
  const post = obj.post === "any" ? "any" : (obj.post === "all" ? "all" : undefined);
  if (!pre && !post) return undefined;
  return { ...(pre ? { pre } : {}), ...(post ? { post } : {}) };
}

function parseGateFailRules(raw: unknown, blockId: string): GateFailRule[] {
  if (!Array.isArray(raw)) return [];

  return raw.map((entry, idx) => {
    if (!entry || typeof entry !== "object") {
      throw new Error(`Invalid ${blockId}.on_gate_fail[${idx}]: must be an object`);
    }
    const r = entry as Record<string, unknown>;
    const when_gate = typeof r.when_gate === "string" ? r.when_gate.trim() : "";
    const route_to = typeof r.route_to === "string" ? r.route_to.trim() : "";
    const max_bounces = Number(r.max_bounces ?? 0);

    if (!when_gate) {
      throw new Error(`Invalid ${blockId}.on_gate_fail[${idx}]: missing non-empty 'when_gate'`);
    }
    if (!route_to) {
      throw new Error(`Invalid ${blockId}.on_gate_fail[${idx}]: missing non-empty 'route_to'`);
    }
    if (!Number.isFinite(max_bounces) || max_bounces <= 0) {
      throw new Error(`Invalid ${blockId}.on_gate_fail[${idx}]: 'max_bounces' must be > 0`);
    }

    if (r.reset_blocks !== undefined && !Array.isArray(r.reset_blocks)) {
      throw new Error(`Invalid ${blockId}.on_gate_fail[${idx}]: 'reset_blocks' must be string[] when provided`);
    }
    const reset_blocks = Array.isArray(r.reset_blocks)
      ? r.reset_blocks.map((v, i) => {
          if (typeof v !== "string" || !v.trim()) {
            throw new Error(`Invalid ${blockId}.on_gate_fail[${idx}].reset_blocks[${i}]: must be non-empty string`);
          }
          return v;
        })
      : undefined;

    return {
      when_gate,
      route_to,
      reset_blocks,
      max_bounces,
      reason: typeof r.reason === "string" ? r.reason : undefined,
      feedback_from: r.feedback_from === "gate_verdicts" ? "gate_verdicts" : undefined,
    };
  });
}

function parseRetryPolicy(raw: unknown): RetryPolicy {
  if (!raw || typeof raw !== "object") {
    return { max_attempts: 0, backoff: "none", delay_ms: 0 };
  }
  const obj = raw as Record<string, unknown>;
  return {
    max_attempts: (obj.max_attempts as number) ?? 0,
    backoff: (obj.backoff as RetryPolicy["backoff"]) ?? "none",
    delay_ms: (obj.delay_ms as number) ?? 1000,
    max_delay_ms: obj.max_delay_ms as number | undefined,
  };
}

function parseApprovalPolicy(raw: unknown): ApprovalPolicy | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const obj = raw as Record<string, unknown>;
  if (obj.required !== true) return undefined;
  return {
    required: true,
    prompt: obj.prompt as string | undefined,
    approver: obj.approver as string | undefined,
    timeout_sec: obj.timeout_sec as number | undefined,
  };
}

function parseEdge(raw: Record<string, unknown>): Edge {
  return {
    from: raw.from as string,
    output: raw.output as string,
    to: raw.to as string,
    input: raw.input as string,
    transform: raw.transform as string | undefined,
  };
}

function detectCycles(blocks: BlockDef[], edges: Edge[]): void {
  const order = topoSort(blocks, edges);
  if (order.length !== blocks.length) {
    const sorted = new Set(order);
    const cycleNodes = blocks.filter((b) => !sorted.has(b.id)).map((b) => b.id);
    throw new Error(`DAG contains cycle(s): ${cycleNodes.join(", ")}`);
  }
}

