import { nanoid } from "nanoid";
import { createHash } from "node:crypto";
import { parseDAG as parseDAGDef } from "./dag-parser.js";
import { evaluateBlockGate } from "./gate-evaluator.js";
import { evaluateSafeExpression } from "./expression-eval.js";
import { topoSort } from "./block-helpers.js";
import type {
  BlockDef,
  BlockExecution,
  BlockInstance,
  DAGDef,
  DAGRun,
  Edge,
  GateResult,
  RetryPolicy,
} from "./block-types.js";

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

export function createBlockEngine() {
  const parseDAG = parseDAGDef;

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

  function resolveReady(dag: DAGDef, run: DAGRun): string[] {
    const ready: string[] = [];
    const edgeIndex = getEdgeIndex(dag);

    for (const blockDef of dag.blocks) {
      const instance = run.blocks[blockDef.id];
      if (!instance || instance.status !== "pending") continue;

      const allInputsSatisfied = Object.entries(blockDef.inputs).every(([portName, portDef]) => {
        if (portDef.required === false && portDef.default !== undefined) return true;
        if (portDef.required === false) return true;

        const incomingEdge = edgeIndex.incomingByBlockPort.get(`${blockDef.id}::${portName}`);
        if (!incomingEdge) {
          return instance.inputs[portName] !== undefined
            || run.context[portName] !== undefined
            || portDef.default !== undefined;
        }

        const sourceInstance = run.blocks[incomingEdge.from];
        return sourceInstance?.status === "completed"
          && sourceInstance.outputs[incomingEdge.output] !== undefined;
      });

      if (allInputsSatisfied) ready.push(blockDef.id);
    }

    return ready;
  }

  function wireInputs(dag: DAGDef, run: DAGRun, blockId: string): Record<string, unknown> {
    const blockDef = dag.blocks.find((b) => b.id === blockId);
    if (!blockDef) throw new Error(`Unknown block: ${blockId}`);

    const inputs: Record<string, unknown> = {};
    const edgeIndex = getEdgeIndex(dag);

    for (const [portName, portDef] of Object.entries(blockDef.inputs)) {
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
    }

    return inputs;
  }

  function evaluatePreGates(blockDef: BlockDef, inputs: Record<string, unknown>): GateResult[] {
    return blockDef.pre_gates.map((gate) => evaluateBlockGate(gate, inputs, {}));
  }

  function evaluatePostGates(blockDef: BlockDef, inputs: Record<string, unknown>, outputs: Record<string, unknown>): GateResult[] {
    return blockDef.post_gates.map((gate) => evaluateBlockGate(gate, inputs, outputs));
  }

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

    if (instance.status === "failed") {
      const allTerminal = Object.values(run.blocks).every(
        (b) => b.status === "completed" || b.status === "failed" || b.status === "skipped"
      );
      if (allTerminal) run.status = "failed";
    }

    return run;
  }

  function isComplete(dag: DAGDef, run: DAGRun): boolean {
    if (!dag.terminals || dag.terminals.length === 0) {
      return Object.values(run.blocks).every(
        (b) => b.status === "completed" || b.status === "skipped"
      );
    }

    return dag.terminals.every((id) => {
      const instance = run.blocks[id];
      return instance?.status === "completed" || instance?.status === "skipped";
    });
  }

  function executionOrder(dag: DAGDef): string[] {
    return topoSort(dag.blocks, dag.edges);
  }

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
