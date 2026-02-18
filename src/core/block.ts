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
import { parseDAG as parseDAGDef } from "./dag-parser.js";
import { evaluateBlockGate } from "./gate-evaluator.js";
import { evaluateSafeExpression } from "./expression-eval.js";

export { evaluateBlockGate } from "./gate-evaluator.js";

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
