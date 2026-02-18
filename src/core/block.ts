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
import { parseDAG as parseDAGDef } from "./dag-parser.js";

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
  const parseDAG = parseDAGDef;

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
