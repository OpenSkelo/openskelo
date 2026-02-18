/**
 * Block Core — the singular composable unit of OpenSkelo.
 *
 * A Block is a deterministic, generic execution unit that:
 * 1. Declares typed inputs and outputs (the DAG edges)
 * 2. Has pre-conditions (gates) that must pass before execution
 * 3. Has post-conditions (gates) that must pass after execution
 * 4. Produces deterministic, auditable results
 * 5. Is retryable with configurable policy
 *
 * Blocks are domain-agnostic. The same Block contract handles:
 * - Code: write, test, review, deploy
 * - Research: gather, synthesize, validate
 * - Content: draft, edit, publish
 * - Data: fetch, transform, load
 * - Ops: provision, configure, verify
 * - Anything else a user defines in YAML
 */

import { nanoid } from "nanoid";
import { createHash } from "node:crypto";
import { parse as parseExpression } from "acorn";

// ── Block Definition (from YAML config) ──

import type {
  ApprovalPolicy,
  AgentRef,
  BlockDef,
  BlockExecution,
  BlockGate,
  BlockGateCheck,
  BlockInstance,
  BlockMode,
  BlockStatus,
  DAGDef,
  DAGRun,
  DeterministicSpec,
  Edge,
  GateComposition,
  GateFailRule,
  GateResult,
  PortDef,
  RetryPolicy,
  RetryState,
} from "./block-types.js";

export type * from "./block-types.js";

// ── Edge Indexing (performance helper) ──

type EdgeIndex = {
  incomingByBlockPort: Map<string, Edge>;
  incomingByBlock: Map<string, Edge[]>;
};

const edgeIndexCache = new WeakMap<DAGDef, EdgeIndex>();

function getEdgeIndex(dag: DAGDef): EdgeIndex {
  const existing = edgeIndexCache.get(dag);
  if (existing) return existing;

  const incomingByBlockPort = new Map<string, Edge>();
  const incomingByBlock = new Map<string, Edge[]>();

  for (const edge of dag.edges) {
    incomingByBlockPort.set(`${edge.to}::${edge.input}`, edge);
    const arr = incomingByBlock.get(edge.to) ?? [];
    arr.push(edge);
    incomingByBlock.set(edge.to, arr);
  }

  const built = { incomingByBlockPort, incomingByBlock };
  edgeIndexCache.set(dag, built);
  return built;
}

// ── Block Engine ──

export function createBlockEngine() {

  /**
   * Parse a DAG definition from YAML-parsed object.
   */
  function parseDAG(raw: Record<string, unknown>): DAGDef {
    const name = raw.name as string;
    if (!name) throw new Error("DAG requires a name");

    const rawBlocks = raw.blocks as Record<string, unknown>[];
    if (!Array.isArray(rawBlocks) || rawBlocks.length === 0) {
      throw new Error("DAG requires at least one block");
    }

    const blocks = rawBlocks.map(parseBlockDef);
    const edges = ((raw.edges ?? []) as Record<string, unknown>[]).map(parseEdge);

    // Validate edges reference real blocks and ports
    const blockMap = new Map(blocks.map(b => [b.id, b]));
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
    const hasIncoming = new Set(edges.map(e => e.to));
    const entrypoints = (raw.entrypoints as string[] | undefined)
      ?? blocks.filter(b => !hasIncoming.has(b.id)).map(b => b.id);

    // Compute terminals (blocks with no outgoing edges)
    const hasOutgoing = new Set(edges.map(e => e.from));
    const terminals = (raw.terminals as string[] | undefined)
      ?? blocks.filter(b => !hasOutgoing.has(b.id)).map(b => b.id);

    // Cycle detection (topological sort via Kahn's algorithm)
    detectCycles(blocks, edges);

    return { name, blocks, edges, entrypoints, terminals };
  }

  /**
   * Create a new DAG run from a definition + initial context.
   */
  function createRun(dag: DAGDef, context: Record<string, unknown> = {}): DAGRun {
    const runId = `run_${nanoid(12)}`;
    const now = new Date().toISOString();

    const blocks: Record<string, BlockInstance> = {};
    for (const blockDef of dag.blocks) {
      blocks[blockDef.id] = {
        instance_id: `bi_${nanoid(10)}`,
        block_id: blockDef.id,
        run_id: runId,
        status: "pending",
        inputs: {},
        outputs: {},
        pre_gate_results: [],
        post_gate_results: [],
        execution: null,
        active_agent_id: undefined,
        active_model: undefined,
        active_provider: undefined,
        retry_state: {
          attempt: 0,
          max_attempts: blockDef.retry.max_attempts,
          next_retry_at: null,
          last_error: null,
        },
        created_at: now,
        started_at: null,
        completed_at: null,
      };
    }

    return {
      id: runId,
      dag_name: dag.name,
      status: "pending",
      blocks,
      context,
      created_at: now,
      updated_at: now,
    };
  }

  /**
   * Resolve which blocks are ready to execute.
   * A block is ready when all required inputs are satisfied.
   */
  function resolveReady(dag: DAGDef, run: DAGRun): string[] {
    const ready: string[] = [];
    const edgeIndex = getEdgeIndex(dag);

    for (const blockDef of dag.blocks) {
      const instance = run.blocks[blockDef.id];
      if (!instance || instance.status !== "pending") continue;

      // Check if all required inputs are satisfied
      const allInputsSatisfied = Object.entries(blockDef.inputs).every(([portName, portDef]) => {
        if (portDef.required === false && portDef.default !== undefined) return true;
        if (portDef.required === false) return true;

        // Check if there's an edge wiring to this input
        const incomingEdge = edgeIndex.incomingByBlockPort.get(`${blockDef.id}::${portName}`);
        if (!incomingEdge) {
          // No edge — check context or default
          return instance.inputs[portName] !== undefined
            || run.context[portName] !== undefined
            || portDef.default !== undefined;
        }

        // Edge exists — check if source block is completed and output is available
        const sourceInstance = run.blocks[incomingEdge.from];
        return sourceInstance?.status === "completed"
          && sourceInstance.outputs[incomingEdge.output] !== undefined;
      });

      if (allInputsSatisfied) ready.push(blockDef.id);
    }

    return ready;
  }

  /**
   * Wire inputs for a block from upstream outputs + context + defaults.
   */
  function wireInputs(dag: DAGDef, run: DAGRun, blockId: string): Record<string, unknown> {
    const blockDef = dag.blocks.find(b => b.id === blockId);
    if (!blockDef) throw new Error(`Unknown block: ${blockId}`);

    const inputs: Record<string, unknown> = {};
    const edgeIndex = getEdgeIndex(dag);

    for (const [portName, portDef] of Object.entries(blockDef.inputs)) {
      // Priority: explicit per-block input override > upstream edge > run context > default
      const overrideKey = `__override_input_${blockId}_${portName}`;
      if (run.context[overrideKey] !== undefined) {
        inputs[portName] = run.context[overrideKey];
        continue;
      }

      const edge = edgeIndex.incomingByBlockPort.get(`${blockId}::${portName}`);

      if (edge) {
        const source = run.blocks[edge.from];
        if (source?.status === "completed") {
          let value = source.outputs[edge.output];
          if (edge.transform) {
            value = applyTransform(value, edge.transform);
          }
          inputs[portName] = value;
          continue;
        }
      }

      if (run.context[portName] !== undefined) {
        inputs[portName] = run.context[portName];
        continue;
      }

      if (portDef.default !== undefined) {
        inputs[portName] = portDef.default;
        continue;
      }

      // Missing required input — leave undefined, pre-gate will catch it
    }

    return inputs;
  }

  /**
   * Evaluate pre-gates for a block.
   */
  function evaluatePreGates(blockDef: BlockDef, inputs: Record<string, unknown>): GateResult[] {
    return blockDef.pre_gates.map(gate => evaluateBlockGate(gate, inputs, {}));
  }

  /**
   * Evaluate post-gates for a block.
   */
  function evaluatePostGates(blockDef: BlockDef, inputs: Record<string, unknown>, outputs: Record<string, unknown>): GateResult[] {
    return blockDef.post_gates.map(gate => evaluateBlockGate(gate, inputs, outputs));
  }

  /**
   * Mark a block as started.
   */
  function startBlock(run: DAGRun, blockId: string, inputs: Record<string, unknown>): DAGRun {
    const instance = run.blocks[blockId];
    if (!instance) throw new Error(`Unknown block instance: ${blockId}`);

    instance.status = "running";
    instance.inputs = inputs;
    instance.started_at = new Date().toISOString();
    instance.retry_state.attempt++;
    run.status = "running";
    run.updated_at = new Date().toISOString();

    return run;
  }

  /**
   * Mark a block as completed with outputs.
   */
  function completeBlock(
    run: DAGRun,
    blockId: string,
    outputs: Record<string, unknown>,
    execution: BlockExecution
  ): DAGRun {
    const instance = run.blocks[blockId];
    if (!instance) throw new Error(`Unknown block instance: ${blockId}`);

    instance.status = "completed";
    instance.outputs = outputs;
    instance.execution = execution;
    instance.completed_at = new Date().toISOString();
    run.updated_at = new Date().toISOString();

    return run;
  }

  /**
   * Mark a block as failed.
   */
  function failBlock(run: DAGRun, blockId: string, error: string, blockDef: BlockDef): DAGRun {
    const instance = run.blocks[blockId];
    if (!instance) throw new Error(`Unknown block instance: ${blockId}`);

    instance.retry_state.last_error = error;

    if (instance.retry_state.attempt < instance.retry_state.max_attempts) {
      instance.status = "retrying";
      const delay = computeRetryDelay(blockDef.retry, instance.retry_state.attempt);
      instance.retry_state.next_retry_at = new Date(Date.now() + delay).toISOString();
    } else {
      instance.status = "failed";
      instance.completed_at = new Date().toISOString();
    }

    run.updated_at = new Date().toISOString();

    // Check if entire DAG should fail
    if (instance.status === "failed") {
      const allTerminal = Object.values(run.blocks).every(
        b => b.status === "completed" || b.status === "failed" || b.status === "skipped"
      );
      if (allTerminal) run.status = "failed";
    }

    return run;
  }

  /**
   * Check if the DAG run is complete.
   */
  function isComplete(dag: DAGDef, run: DAGRun): boolean {
    if (!dag.terminals || dag.terminals.length === 0) {
      // All blocks must be completed
      return Object.values(run.blocks).every(
        b => b.status === "completed" || b.status === "skipped"
      );
    }

    return dag.terminals.every(id => {
      const instance = run.blocks[id];
      return instance?.status === "completed" || instance?.status === "skipped";
    });
  }

  /**
   * Get execution order (topological sort).
   */
  function executionOrder(dag: DAGDef): string[] {
    return topoSort(dag.blocks, dag.edges);
  }

  /**
   * Compute a deterministic hash of the block definition for change detection.
   */
  function hashBlockDef(blockDef: BlockDef): string {
    const canonical = JSON.stringify({
      id: blockDef.id,
      inputs: blockDef.inputs,
      outputs: blockDef.outputs,
      agent: blockDef.agent,
      pre_gates: blockDef.pre_gates,
      post_gates: blockDef.post_gates,
      gate_composition: blockDef.gate_composition,
      retry: blockDef.retry,
      strict_output: blockDef.strict_output,
      contract_repair_attempts: blockDef.contract_repair_attempts,
    });
    return createHash("sha256").update(canonical).digest("hex").slice(0, 16);
  }

  return {
    parseDAG,
    createRun,
    resolveReady,
    wireInputs,
    evaluatePreGates,
    evaluatePostGates,
    startBlock,
    completeBlock,
    failBlock,
    isComplete,
    executionOrder,
    hashBlockDef,
  };
}

// ── Internal helpers ──

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
  const handler = String(obj.handler ?? "").trim();
  if (!handler) {
    throw new Error(`Block '${blockId}' mode=deterministic requires deterministic.handler`);
  }
  const config = obj.config && typeof obj.config === "object"
    ? (obj.config as Record<string, unknown>)
    : undefined;
  return { handler, config };
}

function parsePortDef(raw: unknown, path: string): PortDef {
  const allowedTypes = new Set<PortDef["type"]>(["string", "number", "boolean", "json", "file", "artifact"]);

  // Shorthand: just a type string
  if (typeof raw === "string") {
    if (!allowedTypes.has(raw as PortDef["type"])) {
      throw new Error(`Invalid port type at ${path}: '${raw}'. Allowed: ${Array.from(allowedTypes).join(", ")}`);
    }
    return { type: raw as PortDef["type"], required: true };
  }

  if (!raw || typeof raw !== "object") {
    throw new Error(`Invalid port definition at ${path}`);
  }

  const obj = raw as Record<string, unknown>;
  const type = (obj.type as PortDef["type"]) ?? "string";
  if (!allowedTypes.has(type)) {
    throw new Error(`Invalid port type at ${path}.type: '${String(obj.type)}'. Allowed: ${Array.from(allowedTypes).join(", ")}`);
  }

  return {
    type,
    description: obj.description as string | undefined,
    required: obj.required !== false,
    default: obj.default,
  };
}

function parseAgentRef(raw: Record<string, unknown> | undefined): AgentRef {
  if (!raw) return {};
  return {
    role: raw.role as string | undefined,
    capability: raw.capability as string | undefined,
    specific: raw.specific as string | undefined,
    model_params: (raw.model_params && typeof raw.model_params === "object")
      ? (raw.model_params as Record<string, unknown>)
      : undefined,
  };
}

function parseBlockGates(raw: unknown): BlockGate[] {
  if (!Array.isArray(raw)) return [];

  return raw.map((gateRaw: unknown, i: number) => {
    if (!gateRaw || typeof gateRaw !== "object") {
      throw new Error(`Invalid gate at gates[${i}]: must be an object`);
    }

    const g = gateRaw as Record<string, unknown>;
    const name = String(g.name ?? "").trim();
    if (!name) throw new Error(`Invalid gate at gates[${i}]: 'name' is required`);

    return {
      name,
      check: parseBlockGateCheck(g.check, `gates[${i}].check`),
      error: typeof g.error === "string" && g.error.trim() ? g.error : "Gate failed",
    };
  });
}

function parseBlockGateCheck(raw: unknown, path: string): BlockGateCheck {
  if (!raw || typeof raw !== "object") {
    throw new Error(`Invalid gate check at ${path}: must be an object`);
  }

  const obj = raw as Record<string, unknown>;
  const type = String(obj.type ?? "");

  switch (type) {
    case "port_not_empty": {
      if (typeof obj.port !== "string" || !obj.port.trim()) {
        throw new Error(`Invalid ${path}: port_not_empty requires non-empty 'port'`);
      }
      return { type, port: obj.port };
    }
    case "port_matches": {
      if (typeof obj.port !== "string" || !obj.port.trim()) {
        throw new Error(`Invalid ${path}: port_matches requires non-empty 'port'`);
      }
      if (typeof obj.pattern !== "string" || !obj.pattern) {
        throw new Error(`Invalid ${path}: port_matches requires non-empty 'pattern'`);
      }
      try {
        // Validate regex at parse-time
        new RegExp(obj.pattern);
      } catch {
        throw new Error(`Invalid ${path}: pattern is not a valid regex`);
      }
      if (isPotentiallyUnsafeRegex(obj.pattern)) {
        throw new Error(`Invalid ${path}: pattern rejected by ReDoS safety guard`);
      }
      return { type, port: obj.port, pattern: obj.pattern };
    }
    case "port_min_length": {
      if (typeof obj.port !== "string" || !obj.port.trim()) {
        throw new Error(`Invalid ${path}: port_min_length requires non-empty 'port'`);
      }
      const min = Number(obj.min);
      if (!Number.isFinite(min) || min < 0) {
        throw new Error(`Invalid ${path}: port_min_length requires numeric min >= 0`);
      }
      return { type, port: obj.port, min };
    }
    case "port_type": {
      if (typeof obj.port !== "string" || !obj.port.trim()) {
        throw new Error(`Invalid ${path}: port_type requires non-empty 'port'`);
      }
      if (typeof obj.expected !== "string" || !obj.expected.trim()) {
        throw new Error(`Invalid ${path}: port_type requires non-empty 'expected'`);
      }
      return { type, port: obj.port, expected: obj.expected };
    }
    case "json_schema": {
      if (typeof obj.port !== "string" || !obj.port.trim()) {
        throw new Error(`Invalid ${path}: json_schema requires non-empty 'port'`);
      }
      if (!obj.schema || typeof obj.schema !== "object") {
        throw new Error(`Invalid ${path}: json_schema requires object 'schema'`);
      }
      return { type, port: obj.port, schema: obj.schema as Record<string, unknown> };
    }
    case "http": {
      if (typeof obj.url !== "string" || !obj.url.trim()) {
        throw new Error(`Invalid ${path}: http requires non-empty 'url'`);
      }
      const method = String(obj.method ?? "GET").toUpperCase();
      if (!["GET", "POST", "PUT", "PATCH", "DELETE"].includes(method)) {
        throw new Error(`Invalid ${path}: http method must be GET|POST|PUT|PATCH|DELETE`);
      }
      const expectStatus = Number(obj.expect_status ?? 200);
      if (!Number.isInteger(expectStatus) || expectStatus < 100 || expectStatus > 599) {
        throw new Error(`Invalid ${path}: http expect_status must be integer 100..599`);
      }
      const timeoutMs = Number(obj.timeout_ms ?? 5000);
      if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
        throw new Error(`Invalid ${path}: http timeout_ms must be > 0`);
      }
      return { type, url: obj.url, method: method as "GET" | "POST" | "PUT" | "PATCH" | "DELETE", expect_status: expectStatus, timeout_ms: timeoutMs };
    }
    case "semantic_review": {
      if (typeof obj.port !== "string" || !obj.port.trim()) {
        throw new Error(`Invalid ${path}: semantic_review requires non-empty 'port'`);
      }
      if (!Array.isArray(obj.keywords) || obj.keywords.length === 0) {
        throw new Error(`Invalid ${path}: semantic_review requires non-empty keywords[]`);
      }
      const keywords = obj.keywords.map((k) => String(k).trim()).filter(Boolean);
      if (keywords.length === 0) {
        throw new Error(`Invalid ${path}: semantic_review keywords[] must contain non-empty strings`);
      }
      const minMatches = Number(obj.min_matches ?? Math.min(1, keywords.length));
      if (!Number.isFinite(minMatches) || minMatches < 1) {
        throw new Error(`Invalid ${path}: semantic_review min_matches must be >= 1`);
      }
      return { type, port: obj.port, keywords, min_matches: Math.min(Math.floor(minMatches), keywords.length) };
    }
    case "llm_review": {
      if (typeof obj.port !== "string" || !obj.port.trim()) {
        throw new Error(`Invalid ${path}: llm_review requires non-empty 'port'`);
      }
      if (!Array.isArray(obj.criteria) || obj.criteria.length === 0) {
        throw new Error(`Invalid ${path}: llm_review requires non-empty criteria[]`);
      }
      const criteria = obj.criteria.map((c) => String(c).trim()).filter(Boolean);
      if (criteria.length === 0) {
        throw new Error(`Invalid ${path}: llm_review criteria[] must contain non-empty strings`);
      }
      const passThreshold = Number(obj.pass_threshold ?? 1);
      if (!Number.isFinite(passThreshold) || passThreshold < 0 || passThreshold > 1) {
        throw new Error(`Invalid ${path}: llm_review pass_threshold must be between 0 and 1`);
      }
      const timeoutMs = Number(obj.timeout_ms ?? 15000);
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
      if (typeof obj.left !== "string" || !obj.left.trim()) {
        throw new Error(`Invalid ${path}: diff requires non-empty 'left'`);
      }
      if (typeof obj.right !== "string" || !obj.right.trim()) {
        throw new Error(`Invalid ${path}: diff requires non-empty 'right'`);
      }
      const mode = String(obj.mode ?? "equal").trim();
      if (mode !== "equal" && mode !== "not_equal") {
        throw new Error(`Invalid ${path}: diff mode must be 'equal' or 'not_equal'`);
      }
      return { type, left: obj.left, right: obj.right, mode: mode as "equal" | "not_equal" };
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

export function evaluateBlockGate(
  gate: BlockGate,
  inputs: Record<string, unknown>,
  outputs: Record<string, unknown>
): GateResult {
  const ports = { ...inputs, ...outputs };

  switch (gate.check.type) {
    case "port_not_empty": {
      const val = ports[gate.check.port];
      if (val === undefined || val === null || String(val).trim() === "") {
        return { name: gate.name, passed: false, reason: gate.error };
      }
      return { name: gate.name, passed: true };
    }

    case "port_matches": {
      const val = String(ports[gate.check.port] ?? "");
      if (!new RegExp(gate.check.pattern).test(val)) {
        return { name: gate.name, passed: false, reason: gate.error };
      }
      return { name: gate.name, passed: true };
    }

    case "port_min_length": {
      const val = String(ports[gate.check.port] ?? "");
      if (val.length < gate.check.min) {
        return { name: gate.name, passed: false, reason: gate.error };
      }
      return { name: gate.name, passed: true };
    }

    case "port_type": {
      const val = ports[gate.check.port];
      const actual = typeof val;
      if (actual !== gate.check.expected) {
        return { name: gate.name, passed: false, reason: `Expected ${gate.check.expected}, got ${actual}` };
      }
      return { name: gate.name, passed: true };
    }

    case "json_schema": {
      const val = ports[gate.check.port];
      const check = validateSimpleJsonSchema(val, gate.check.schema);
      if (!check.ok) {
        return { name: gate.name, passed: false, reason: `${gate.error} (${check.error})` };
      }
      return { name: gate.name, passed: true, audit: { gate_type: "json_schema" } };
    }

    case "http": {
      const probe = evaluateHttpGate(gate.check);
      if (!probe.ok) {
        return {
          name: gate.name,
          passed: false,
          reason: `${gate.error} (${probe.error})`,
          audit: { gate_type: "http", ...(probe.audit ?? {}) },
        };
      }
      return { name: gate.name, passed: true, audit: { gate_type: "http", ...(probe.audit ?? {}) } };
    }

    case "semantic_review": {
      const text = String(ports[gate.check.port] ?? "").toLowerCase();
      const keywords = gate.check.keywords.map((k) => k.toLowerCase());
      const matched = keywords.filter((k) => text.includes(k));
      const minMatches = gate.check.min_matches ?? 1;
      if (matched.length < minMatches) {
        return {
          name: gate.name,
          passed: false,
          reason: `${gate.error} (matched ${matched.length}/${minMatches})`,
          audit: { gate_type: "semantic_review", matched, required: minMatches },
        };
      }
      return { name: gate.name, passed: true, audit: { gate_type: "semantic_review", matched, required: minMatches } };
    }

    case "llm_review": {
      return {
        name: gate.name,
        passed: false,
        reason: `${gate.error} (llm_review requires executor evaluation path)`,
        audit: { gate_type: "llm_review", status: "deferred" },
      };
    }

    case "diff": {
      const leftVal = ports[gate.check.left];
      const rightVal = ports[gate.check.right];
      const left = stableStringify(leftVal);
      const right = stableStringify(rightVal);
      const mode = gate.check.mode ?? "equal";
      const ok = mode === "equal" ? left === right : left !== right;
      if (!ok) {
        return {
          name: gate.name,
          passed: false,
          reason: `${gate.error} (diff ${mode} check failed for '${gate.check.left}' vs '${gate.check.right}')`,
          audit: { gate_type: "diff", mode },
        };
      }
      return { name: gate.name, passed: true, audit: { gate_type: "diff", mode } };
    }

    case "cost": {
      const port = gate.check.port ?? "__cost";
      const value = Number(ports[port] ?? 0);
      if (!Number.isFinite(value)) {
        return { name: gate.name, passed: false, reason: `${gate.error} (invalid cost value)` };
      }
      if (value > gate.check.max) {
        return { name: gate.name, passed: false, reason: `${gate.error} (cost ${value} > ${gate.check.max})` };
      }
      return { name: gate.name, passed: true, audit: { gate_type: "cost", value, max: gate.check.max, port } };
    }

    case "latency": {
      const port = gate.check.port ?? "__latency_ms";
      const value = Number(ports[port] ?? 0);
      if (!Number.isFinite(value)) {
        return { name: gate.name, passed: false, reason: `${gate.error} (invalid latency value)` };
      }
      if (value > gate.check.max_ms) {
        return { name: gate.name, passed: false, reason: `${gate.error} (latency ${value}ms > ${gate.check.max_ms}ms)` };
      }
      return { name: gate.name, passed: true, audit: { gate_type: "latency", value_ms: value, max_ms: gate.check.max_ms, port } };
    }

    case "shell": {
      const allowShellGates = isShellGateEnabled();
      if (!allowShellGates) {
        return {
          name: gate.name,
          passed: false,
          reason: `${gate.error} (shell gates disabled; set OPENSKELO_ALLOW_SHELL_GATES=true to enable)`,
          audit: {
            gate_type: "shell",
            command: gate.check.command,
            enabled: false,
            status: "blocked",
          },
        };
      }

      const timeoutMs = Number(process.env.OPENSKELO_SHELL_GATE_TIMEOUT_MS ?? "10000");
      const started = Date.now();
      try {
        const { execSync } = require("node:child_process");
        execSync(gate.check.command, { timeout: timeoutMs, stdio: "pipe", env: process.env });
        const durationMs = Date.now() - started;
        return {
          name: gate.name,
          passed: true,
          audit: {
            gate_type: "shell",
            command: gate.check.command,
            enabled: true,
            timeout_ms: timeoutMs,
            duration_ms: durationMs,
            status: "passed",
          },
        };
      } catch (err) {
        const durationMs = Date.now() - started;
        const shellErr = err as { status?: number; signal?: string; message?: string };
        return {
          name: gate.name,
          passed: false,
          reason: `${gate.error} (${shellErr.message ?? "shell execution failed"})`,
          audit: {
            gate_type: "shell",
            command: gate.check.command,
            enabled: true,
            timeout_ms: timeoutMs,
            duration_ms: durationMs,
            status: "failed",
            exit_code: shellErr.status,
            signal: shellErr.signal,
            error: shellErr.message,
          },
        };
      }
    }

    case "expr": {
      try {
        const result = evaluateSafeExpression(gate.check.expression, { inputs, outputs });
        return { name: gate.name, passed: !!result };
      } catch (err) {
        return { name: gate.name, passed: false, reason: `Expression error: ${(err as Error).message}` };
      }
    }

    default:
      return { name: gate.name, passed: false, reason: "Unknown gate check type" };
  }
}

function computeRetryDelay(policy: RetryPolicy, attempt: number): number {
  let delay: number;
  switch (policy.backoff) {
    case "linear":
      delay = policy.delay_ms * attempt;
      break;
    case "exponential":
      delay = policy.delay_ms * Math.pow(2, attempt - 1);
      break;
    default:
      delay = policy.delay_ms;
  }
  if (policy.max_delay_ms) delay = Math.min(delay, policy.max_delay_ms);
  return delay;
}

function applyTransform(value: unknown, transform: string): unknown {
  try {
    return evaluateSafeExpression(transform, { value });
  } catch {
    return value;
  }
}

function detectCycles(blocks: BlockDef[], edges: Edge[]): void {
  topoSort(blocks, edges); // throws on cycle
}

function isPotentiallyUnsafeRegex(pattern: string): boolean {
  // Heuristic ReDoS guard:
  // 1) Nested quantifiers like (a+)+ or (.+)*
  // 2) Excessive length
  if (pattern.length > 256) return true;
  const nestedQuantifier = /\((?:[^()\\]|\\.)*[+*](?:[^()\\]|\\.)*\)[+*{]/;
  return nestedQuantifier.test(pattern);
}

function suggestClosest(input: string, options: string[]): string | null {
  if (!input || options.length === 0) return null;
  let best: { value: string; dist: number } | null = null;
  for (const opt of options) {
    const dist = levenshtein(input, opt);
    if (!best || dist < best.dist) best = { value: opt, dist };
  }
  if (!best) return null;
  const threshold = Math.max(1, Math.floor(Math.max(input.length, best.value.length) * 0.4));
  return best.dist <= threshold ? best.value : null;
}

function levenshtein(a: string, b: string): number {
  const dp: number[][] = Array.from({ length: a.length + 1 }, () => Array(b.length + 1).fill(0));
  for (let i = 0; i <= a.length; i++) dp[i][0] = i;
  for (let j = 0; j <= b.length; j++) dp[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(
        dp[i - 1][j] + 1,
        dp[i][j - 1] + 1,
        dp[i - 1][j - 1] + cost
      );
    }
  }
  return dp[a.length][b.length];
}

function evaluateHttpGate(check: { url: string; method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE"; expect_status?: number; timeout_ms?: number }): { ok: boolean; error?: string; audit?: Record<string, unknown> } {
  // Deterministic mock path for local/offline testing.
  const mock = check.url.match(/^mock:\/\/status\/(\d{3})$/);
  if (mock) {
    const status = Number(mock[1]);
    const expectStatus = Number(check.expect_status ?? 200);
    return {
      ok: status === expectStatus,
      error: status === expectStatus ? undefined : `expected status ${expectStatus}, got ${status}`,
      audit: { url: check.url, method: check.method ?? "GET", status, expect_status: expectStatus, mock: true },
    };
  }

  const timeoutMs = Number(check.timeout_ms ?? 5000);
  const expectStatus = Number(check.expect_status ?? 200);
  try {
    const { execSync } = require("node:child_process");
    const cmd = `curl -s -o /dev/null -w "%{http_code}" --max-time ${Math.ceil(timeoutMs / 1000)} -X ${check.method ?? "GET"} ${JSON.stringify(check.url)}`;
    const out = String(execSync(cmd, { stdio: ["ignore", "pipe", "pipe"] })).trim();
    const status = Number(out);
    return {
      ok: status === expectStatus,
      error: status === expectStatus ? undefined : `expected status ${expectStatus}, got ${status}`,
      audit: { url: check.url, method: check.method ?? "GET", status, expect_status: expectStatus, timeout_ms: timeoutMs },
    };
  } catch (err) {
    return { ok: false, error: (err as Error).message, audit: { url: check.url, method: check.method ?? "GET", timeout_ms: timeoutMs } };
  }
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((v) => stableStringify(v)).join(",")}]`;
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`).join(",")}}`;
}

function validateSimpleJsonSchema(value: unknown, schema: Record<string, unknown>): { ok: boolean; error?: string } {
  const expectedType = String(schema.type ?? "").trim();

  if (expectedType === "object") {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      return { ok: false, error: "expected object" };
    }

    const required = Array.isArray(schema.required) ? schema.required.map(String) : [];
    for (const key of required) {
      if (!(key in (value as Record<string, unknown>))) {
        return { ok: false, error: `missing required key '${key}'` };
      }
    }

    const properties = (schema.properties && typeof schema.properties === "object")
      ? (schema.properties as Record<string, Record<string, unknown>>)
      : {};

    for (const [key, propSchema] of Object.entries(properties)) {
      if (!(key in (value as Record<string, unknown>))) continue;
      const propVal = (value as Record<string, unknown>)[key];
      const propType = String(propSchema.type ?? "").trim();
      if (!propType) continue;
      const actual = Array.isArray(propVal) ? "array" : typeof propVal;
      if (actual !== propType) {
        return { ok: false, error: `property '${key}' expected ${propType}, got ${actual}` };
      }
    }

    return { ok: true };
  }

  if (expectedType) {
    const actual = Array.isArray(value) ? "array" : typeof value;
    if (actual !== expectedType) {
      return { ok: false, error: `expected ${expectedType}, got ${actual}` };
    }
  }

  return { ok: true };
}

function isShellGateEnabled(): boolean {
  const raw = String(process.env.OPENSKELO_ALLOW_SHELL_GATES ?? "").trim().toLowerCase();
  return raw === "1" || raw === "true" || raw === "yes" || raw === "on";
}

function topoSort(blocks: BlockDef[], edges: Edge[]): string[] {
  const inDegree = new Map<string, number>();
  const adj = new Map<string, string[]>();

  for (const b of blocks) {
    inDegree.set(b.id, 0);
    adj.set(b.id, []);
  }

  for (const e of edges) {
    adj.get(e.from)!.push(e.to);
    inDegree.set(e.to, (inDegree.get(e.to) ?? 0) + 1);
  }

  const queue: string[] = [];
  for (const [id, deg] of inDegree) {
    if (deg === 0) queue.push(id);
  }

  const sorted: string[] = [];
  while (queue.length > 0) {
    const node = queue.shift()!;
    sorted.push(node);
    for (const neighbor of adj.get(node) ?? []) {
      const newDeg = (inDegree.get(neighbor) ?? 1) - 1;
      inDegree.set(neighbor, newDeg);
      if (newDeg === 0) queue.push(neighbor);
    }
  }

  if (sorted.length !== blocks.length) {
    const remaining = blocks.filter(b => !sorted.includes(b.id)).map(b => b.id);
    throw new Error(`DAG contains a cycle involving blocks: ${remaining.join(", ")}`);
  }

  return sorted;
}

// Safe expression evaluator for gate.expr and edge transforms.
// Supports literals, logical/binary/unary expressions, conditionals,
// array/object literals, and member access rooted at allowed identifiers.
// Disallows function calls, assignments, constructors, and global access.
export function evaluateSafeExpression(expression: string, scope: Record<string, unknown>): unknown {
  const program = parseExpression(expression, { ecmaVersion: 2020 }) as unknown as {
    type: string;
    body?: Array<Record<string, unknown>>;
  };

  if (program.type !== "Program" || !Array.isArray(program.body) || program.body.length !== 1) {
    throw new Error("Expression must be a single expression");
  }

  const stmt = program.body[0] as Record<string, unknown>;
  if (stmt.type !== "ExpressionStatement") {
    throw new Error("Expression statement required");
  }

  return evalNode((stmt.expression as Record<string, unknown>), scope);
}

function evalNode(node: Record<string, unknown>, scope: Record<string, unknown>): unknown {
  const type = String(node.type ?? "");

  switch (type) {
    case "Literal":
      return node.value;

    case "Identifier": {
      const name = String(node.name ?? "");
      if (!(name in scope)) throw new Error(`Unknown identifier: ${name}`);
      return scope[name];
    }

    case "MemberExpression": {
      const obj = evalNode(node.object as Record<string, unknown>, scope);
      if (obj === null || obj === undefined) return undefined;
      const computed = Boolean(node.computed);
      const key = computed
        ? evalNode(node.property as Record<string, unknown>, scope)
        : String((node.property as Record<string, unknown>).name ?? "");
      if (typeof key !== "string" && typeof key !== "number") throw new Error("Invalid member key");
      return (obj as Record<string, unknown>)[String(key)];
    }

    case "UnaryExpression": {
      const op = String(node.operator ?? "");
      const arg = evalNode(node.argument as Record<string, unknown>, scope);
      if (op === "!") return !arg;
      if (op === "+") return Number(arg);
      if (op === "-") return -Number(arg);
      throw new Error(`Unsupported unary operator: ${op}`);
    }

    case "LogicalExpression": {
      const op = String(node.operator ?? "");
      if (op === "&&") return evalNode(node.left as Record<string, unknown>, scope) && evalNode(node.right as Record<string, unknown>, scope);
      if (op === "||") return evalNode(node.left as Record<string, unknown>, scope) || evalNode(node.right as Record<string, unknown>, scope);
      if (op === "??") {
        const left = evalNode(node.left as Record<string, unknown>, scope);
        return left ?? evalNode(node.right as Record<string, unknown>, scope);
      }
      throw new Error(`Unsupported logical operator: ${op}`);
    }

    case "BinaryExpression": {
      const op = String(node.operator ?? "");
      const left = evalNode(node.left as Record<string, unknown>, scope) as unknown;
      const right = evalNode(node.right as Record<string, unknown>, scope) as unknown;
      switch (op) {
        case "==": return left == right; // eslint-disable-line eqeqeq
        case "!=": return left != right; // eslint-disable-line eqeqeq
        case "===": return left === right;
        case "!==": return left !== right;
        case ">": return (left as number) > (right as number);
        case ">=": return (left as number) >= (right as number);
        case "<": return (left as number) < (right as number);
        case "<=": return (left as number) <= (right as number);
        case "+": return (left as number) + (right as number);
        case "-": return (left as number) - (right as number);
        case "*": return (left as number) * (right as number);
        case "/": return (left as number) / (right as number);
        case "%": return (left as number) % (right as number);
        default: throw new Error(`Unsupported binary operator: ${op}`);
      }
    }

    case "ConditionalExpression":
      return evalNode(node.test as Record<string, unknown>, scope)
        ? evalNode(node.consequent as Record<string, unknown>, scope)
        : evalNode(node.alternate as Record<string, unknown>, scope);

    case "ArrayExpression":
      return ((node.elements as Array<Record<string, unknown> | null>) ?? []).map((el) => (el ? evalNode(el, scope) : null));

    case "ObjectExpression": {
      const out: Record<string, unknown> = {};
      const props = (node.properties as Array<Record<string, unknown>>) ?? [];
      for (const p of props) {
        if (String(p.type) !== "Property") throw new Error("Unsupported object property");
        const keyNode = p.key as Record<string, unknown>;
        const key = keyNode.type === "Identifier" ? String(keyNode.name ?? "") : String(keyNode.value ?? "");
        out[key] = evalNode(p.value as Record<string, unknown>, scope);
      }
      return out;
    }

    case "TemplateLiteral": {
      const quasis = (node.quasis as Array<Record<string, unknown>>) ?? [];
      const exprs = (node.expressions as Array<Record<string, unknown>>) ?? [];
      let result = "";
      for (let i = 0; i < quasis.length; i++) {
        result += String((quasis[i].value as Record<string, unknown>)?.cooked ?? "");
        if (exprs[i]) result += String(evalNode(exprs[i], scope));
      }
      return result;
    }

    case "CallExpression":
    case "NewExpression":
    case "AssignmentExpression":
    case "UpdateExpression":
    case "FunctionExpression":
    case "ArrowFunctionExpression":
      throw new Error(`Disallowed expression node: ${type}`);

    default:
      throw new Error(`Unsupported expression node: ${type}`);
  }
}
