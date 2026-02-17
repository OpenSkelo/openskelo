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

// ── Block Definition (from YAML config) ──

export interface BlockDef {
  /** Unique block ID within the DAG (e.g., "build", "review", "deploy") */
  id: string;

  /** Human-readable name */
  name: string;

  /** What this block needs to run — keys are port names, values are type descriptors */
  inputs: Record<string, PortDef>;

  /** What this block produces — keys are port names, values are type descriptors */
  outputs: Record<string, PortDef>;

  /** Agent routing: which agent handles this block */
  agent: AgentRef;

  /** Pre-execution gates — all must pass before block runs */
  pre_gates: BlockGate[];

  /** Post-execution gates — all must pass after block runs (before outputs propagate) */
  post_gates: BlockGate[];

  /** Retry policy on failure */
  retry: RetryPolicy;

  /** Optional timeout in ms */
  timeout_ms?: number;

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

  /** Provider used */
  provider: string;

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
  status: "pending" | "running" | "completed" | "failed" | "cancelled";

  /** All block instances in this run */
  blocks: Record<string, BlockInstance>;

  /** Global context (user-provided initial inputs) */
  context: Record<string, unknown>;

  /** Timestamps */
  created_at: string;
  updated_at: string;
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
    for (const edge of edges) {
      const fromBlock = blockMap.get(edge.from);
      if (!fromBlock) throw new Error(`Edge references unknown block: ${edge.from}`);
      if (!fromBlock.outputs[edge.output]) {
        throw new Error(`Edge references unknown output port: ${edge.from}.${edge.output}`);
      }

      const toBlock = blockMap.get(edge.to);
      if (!toBlock) throw new Error(`Edge references unknown block: ${edge.to}`);
      if (!toBlock.inputs[edge.input]) {
        throw new Error(`Edge references unknown input port: ${edge.to}.${edge.input}`);
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

    for (const blockDef of dag.blocks) {
      const instance = run.blocks[blockDef.id];
      if (!instance || instance.status !== "pending") continue;

      // Check if all required inputs are satisfied
      const allInputsSatisfied = Object.entries(blockDef.inputs).every(([portName, portDef]) => {
        if (portDef.required === false && portDef.default !== undefined) return true;
        if (portDef.required === false) return true;

        // Check if there's an edge wiring to this input
        const incomingEdge = dag.edges.find(e => e.to === blockDef.id && e.input === portName);
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

    for (const [portName, portDef] of Object.entries(blockDef.inputs)) {
      // Priority: upstream edge > run context > default
      const edge = dag.edges.find(e => e.to === blockId && e.input === portName);

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
      retry: blockDef.retry,
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

  return {
    id,
    name: (raw.name as string) ?? id,
    inputs,
    outputs,
    agent: parseAgentRef(raw.agent as Record<string, unknown> | undefined),
    pre_gates: parseBlockGates(raw.pre_gates),
    post_gates: parseBlockGates(raw.post_gates),
    retry: parseRetryPolicy(raw.retry),
    timeout_ms: raw.timeout_ms as number | undefined,
    metadata: raw.metadata as Record<string, unknown> | undefined,
  };
}

function parsePortDef(raw: unknown, path: string): PortDef {
  // Shorthand: just a type string
  if (typeof raw === "string") {
    return { type: raw as PortDef["type"], required: true };
  }

  if (!raw || typeof raw !== "object") {
    throw new Error(`Invalid port definition at ${path}`);
  }

  const obj = raw as Record<string, unknown>;
  return {
    type: (obj.type as PortDef["type"]) ?? "string",
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
  };
}

function parseBlockGates(raw: unknown): BlockGate[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((g: Record<string, unknown>) => ({
    name: g.name as string,
    check: g.check as BlockGateCheck,
    error: (g.error as string) ?? "Gate failed",
  }));
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

function parseEdge(raw: Record<string, unknown>): Edge {
  return {
    from: raw.from as string,
    output: raw.output as string,
    to: raw.to as string,
    input: raw.input as string,
    transform: raw.transform as string | undefined,
  };
}

function evaluateBlockGate(
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

    case "shell": {
      try {
        const { execSync } = require("node:child_process");
        execSync(gate.check.command, { timeout: 10000, stdio: "pipe" });
        return { name: gate.name, passed: true };
      } catch {
        return { name: gate.name, passed: false, reason: gate.error };
      }
    }

    case "expr": {
      // Simple expression evaluator — truthy check on a JS expression
      // SECURITY: only allow in trusted configs, never user input
      try {
        const fn = new Function("inputs", "outputs", `return !!(${gate.check.expression})`);
        const result = fn(inputs, outputs);
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
  // Simple transform expressions — extend as needed
  try {
    const fn = new Function("value", `return ${transform}`);
    return fn(value);
  } catch {
    return value;
  }
}

function detectCycles(blocks: BlockDef[], edges: Edge[]): void {
  topoSort(blocks, edges); // throws on cycle
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
