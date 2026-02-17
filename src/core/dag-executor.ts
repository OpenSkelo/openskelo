/**
 * DAG Executor — orchestrates block execution across a DAG.
 *
 * Responsibilities:
 * 1. Resolve which blocks are ready (all inputs satisfied)
 * 2. Wire inputs from upstream outputs + context
 * 3. Evaluate pre-gates before dispatch
 * 4. Dispatch to agent via provider adapter
 * 5. Evaluate post-gates after completion
 * 6. Propagate outputs to downstream blocks
 * 7. Handle retries, failures, and DAG completion
 *
 * The executor is event-driven and supports parallel execution
 * of independent blocks (blocks with no shared dependencies).
 */

import { createBlockEngine } from "./block.js";
import type {
  BlockDef,
  BlockExecution,
  BlockInstance,
  DAGDef,
  DAGRun,
  GateResult,
} from "./block.js";
import type { ProviderAdapter, DispatchRequest, DispatchResult } from "../types.js";

export interface ExecutorOpts {
  /** Provider adapters keyed by provider name */
  providers: Record<string, ProviderAdapter>;

  /** Agent definitions for routing */
  agents: Record<string, { role: string; capabilities: string[]; provider: string; model: string }>;

  /** Called when a block starts */
  onBlockStart?: (run: DAGRun, blockId: string) => void;

  /** Called when a block completes */
  onBlockComplete?: (run: DAGRun, blockId: string) => void;

  /** Called when a block fails */
  onBlockFail?: (run: DAGRun, blockId: string, error: string) => void;

  /** Called when the entire DAG completes */
  onRunComplete?: (run: DAGRun) => void;

  /** Called when the entire DAG fails */
  onRunFail?: (run: DAGRun) => void;

  /** Called when a block is waiting for human approval */
  onApprovalRequired?: (run: DAGRun, blockId: string, approval: Record<string, unknown>) => void;

  /** Max parallel blocks executing simultaneously (default: 4) */
  maxParallel?: number;

  /** Optional cancellation signal for hard stop */
  abortSignal?: AbortSignal;

  /** Optional run cancellation predicate */
  isCancelled?: () => boolean;
}

export interface ExecutorResult {
  run: DAGRun;
  /** Ordered list of block executions for audit */
  trace: TraceEntry[];
}

export interface TraceEntry {
  block_id: string;
  instance_id: string;
  status: "completed" | "failed" | "skipped";
  inputs: Record<string, unknown>;
  outputs: Record<string, unknown>;
  pre_gates: GateResult[];
  post_gates: GateResult[];
  execution: BlockExecution | null;
  duration_ms: number;
}

export function createDAGExecutor(opts: ExecutorOpts) {
  const engine = createBlockEngine();
  const maxParallel = opts.maxParallel ?? 4;

  /**
   * Execute a full DAG run. Returns when all blocks are done or failed.
   * If an existing run is provided, mutates it in place (for API state sharing).
   */
  async function execute(dag: DAGDef, context: Record<string, unknown> = {}, existingRun?: DAGRun): Promise<ExecutorResult> {
    const run = existingRun ?? engine.createRun(dag, context);
    const trace: TraceEntry[] = [];
    const order = engine.executionOrder(dag);

    run.status = "running";

    // Main execution loop
    while (true) {
      if (run.status === "cancelled" || opts.isCancelled?.() || opts.abortSignal?.aborted) {
        run.status = "cancelled";
        break;
      }

      // Pause loop when waiting for human approval
      if (run.status === "paused_approval") {
        await sleep(250);
        continue;
      }

      // Find blocks ready to execute
      const ready = engine.resolveReady(dag, run);

      if (ready.length === 0) {
        // No blocks ready — either done or stuck
        if (engine.isComplete(dag, run)) {
          run.status = "completed";
          opts.onRunComplete?.(run);
          break;
        }

        // Check for retrying blocks
        const retrying = Object.values(run.blocks).filter(b => b.status === "retrying");
        if (retrying.length > 0) {
          // Wait for the earliest retry
          const earliest = retrying.reduce((a, b) => {
            const aTime = a.retry_state.next_retry_at ?? "";
            const bTime = b.retry_state.next_retry_at ?? "";
            return aTime < bTime ? a : b;
          });
          const waitMs = Math.max(0,
            new Date(earliest.retry_state.next_retry_at!).getTime() - Date.now()
          );
          await sleep(waitMs);

          // Reset retrying blocks to pending so they get picked up
          for (const b of retrying) {
            if (b.retry_state.next_retry_at && new Date(b.retry_state.next_retry_at).getTime() <= Date.now()) {
              b.status = "pending";
            }
          }
          continue;
        }

        // Check for any running blocks
        const running = Object.values(run.blocks).filter(b => b.status === "running");
        if (running.length > 0) {
          // Still executing — wait a tick
          await sleep(100);
          continue;
        }

        // Truly stuck — fail the run
        run.status = "failed";
        opts.onRunFail?.(run);
        break;
      }

      // Execute ready blocks (up to maxParallel)
      const batch = ready.slice(0, maxParallel);
      const results = await Promise.allSettled(
        batch.map(blockId => executeBlock(dag, run, blockId, trace))
      );

      // Check for catastrophic failures
      for (let i = 0; i < results.length; i++) {
        const result = results[i];
        if (result.status === "rejected") {
          console.error(`[dag-executor] Block '${batch[i]}' crashed:`, result.reason);
        } else if (result.status === "fulfilled") {
          // Log successful block execution
        }
      }
    }

    return { run, trace };
  }

  /**
   * Execute a single block within a DAG run.
   */
  async function executeBlock(
    dag: DAGDef,
    run: DAGRun,
    blockId: string,
    trace: TraceEntry[]
  ): Promise<void> {
    const blockDef = dag.blocks.find(b => b.id === blockId);
    if (!blockDef) throw new Error(`Unknown block: ${blockId}`);

    if (run.status === "cancelled" || opts.isCancelled?.() || opts.abortSignal?.aborted) return;

    const startTime = Date.now();

    // 1. Wire inputs
    const inputs = engine.wireInputs(dag, run, blockId);

    // 1.5 Optional human approval pause gate
    const needsApproval = blockDef.approval?.required === true;
    const approvalKey = `__approval_${blockId}`;
    const approved = run.context[approvalKey] === true;
    const devAutoApprove = run.context.__dev_auto_approve === true;
    if (needsApproval && !approved) {
      if (devAutoApprove) {
        run.context[approvalKey] = true;
      } else {
        const existing = run.context.__approval_request as Record<string, unknown> | undefined;
        const isSamePending = existing?.status === "pending" && existing?.block_id === blockId;
        if (!isSamePending) {
          const token = `apr_${run.id}_${blockId}_${Date.now().toString(36)}`;
          const request = {
            token,
            run_id: run.id,
            block_id: blockId,
            dag_name: dag.name,
            status: "pending",
            requested_at: new Date().toISOString(),
            prompt: blockDef.approval?.prompt ?? `Approve block ${blockDef.name}?`,
            approver: blockDef.approval?.approver ?? "owner",
            timeout_sec: blockDef.approval?.timeout_sec ?? 1800,
            context_preview: inputs,
          };
          run.context.__approval_request = request;
          run.status = "paused_approval";
          opts.onApprovalRequired?.(run, blockId, request);
        }
        return;
      }
    }

    engine.startBlock(run, blockId, inputs);

    // Resolve agent early so UI can show who is working while running
    const agent = resolveAgent(blockDef);
    if (agent) {
      const provider = opts.providers[agent.provider];
      run.blocks[blockId].active_agent_id = inferDisplayAgentId(agent.id, agent.role, provider?.type);
      run.blocks[blockId].active_model = agent.model;
      run.blocks[blockId].active_provider = agent.provider;
    }

    opts.onBlockStart?.(run, blockId);

    // 2. Evaluate pre-gates
    const preGates = engine.evaluatePreGates(blockDef, inputs);
    run.blocks[blockId].pre_gate_results = preGates;

    const failedPreGate = preGates.find(g => !g.passed);
    if (failedPreGate) {
      // Generic gate-failure reroute/bounce policy
      const rule = (blockDef.on_gate_fail ?? []).find((r) => r.when_gate === failedPreGate.name);
      if (rule) {
        const key = `__bounce_${blockId}_${rule.when_gate}`;
        const bounce = Number((run.context[key] as number) ?? 0) + 1;
        run.context[key] = bounce;

        if (bounce <= rule.max_bounces) {
          const toReset = new Set<string>([blockId, ...(rule.reset_blocks ?? []), rule.route_to]);
          for (const retryBlock of toReset) {
            const inst = run.blocks[retryBlock];
            if (!inst) continue;
            inst.status = "pending";
            inst.outputs = {};
            inst.execution = null;
            inst.started_at = null;
            inst.completed_at = null;
          }

          opts.onBlockFail?.(
            run,
            blockId,
            `${rule.reason ?? "Gate failure reroute"} Bounce ${bounce}/${rule.max_bounces} → rerouting to ${rule.route_to}.`
          );
          trace.push({
            block_id: blockId,
            instance_id: run.blocks[blockId].instance_id,
            status: "failed",
            inputs,
            outputs: {},
            pre_gates: preGates,
            post_gates: [],
            execution: null,
            duration_ms: Date.now() - startTime,
          });
          return;
        }
      }

      engine.failBlock(run, blockId, `Pre-gate failed: ${failedPreGate.name} — ${failedPreGate.reason}`, blockDef);
      opts.onBlockFail?.(run, blockId, failedPreGate.reason ?? "Pre-gate failed");
      trace.push({
        block_id: blockId,
        instance_id: run.blocks[blockId].instance_id,
        status: "failed",
        inputs,
        outputs: {},
        pre_gates: preGates,
        post_gates: [],
        execution: null,
        duration_ms: Date.now() - startTime,
      });
      return;
    }

    // 3. Ensure agent exists
    if (!agent) {
      engine.failBlock(run, blockId, `No agent found for block ${blockId}`, blockDef);
      opts.onBlockFail?.(run, blockId, "No agent found");
      trace.push({
        block_id: blockId,
        instance_id: run.blocks[blockId].instance_id,
        status: "failed",
        inputs,
        outputs: {},
        pre_gates: preGates,
        post_gates: [],
        execution: null,
        duration_ms: Date.now() - startTime,
      });
      return;
    }

    // 4. Dispatch to provider
    const provider = opts.providers[agent.provider];
    if (!provider) {
      engine.failBlock(run, blockId, `Provider not found: ${agent.provider}`, blockDef);
      opts.onBlockFail?.(run, blockId, `Provider not found: ${agent.provider}`);
      return;
    }

    const dispatchRequest: DispatchRequest = {
      taskId: run.blocks[blockId].instance_id,
      pipeline: dag.name,
      title: blockDef.name,
      description: buildBlockPrompt(blockDef, inputs),
      context: inputs,
      acceptanceCriteria: blockDef.post_gates.map(g => g.error),
      bounceCount: run.blocks[blockId].retry_state.attempt - 1,
      abortSignal: opts.abortSignal,
      isCancelled: opts.isCancelled,
      agent: {
        id: agent.id,
        role: agent.role,
        model: agent.model,
      },
    };

    let dispatchResult: DispatchResult;
    try {
      dispatchResult = await provider.dispatch(dispatchRequest);
    } catch (err) {
      const error = err instanceof Error ? err.message : "Unknown dispatch error";
      if (run.status === "cancelled" || opts.isCancelled?.() || opts.abortSignal?.aborted) {
        run.blocks[blockId].status = "skipped";
        return;
      }
      engine.failBlock(run, blockId, error, blockDef);
      opts.onBlockFail?.(run, blockId, error);
      trace.push({
        block_id: blockId,
        instance_id: run.blocks[blockId].instance_id,
        status: "failed",
        inputs,
        outputs: {},
        pre_gates: preGates,
        post_gates: [],
        execution: null,
        duration_ms: Date.now() - startTime,
      });
      return;
    }

    if (!dispatchResult.success) {
      if (run.status === "cancelled" || opts.isCancelled?.() || opts.abortSignal?.aborted) {
        run.blocks[blockId].status = "skipped";
        return;
      }
      engine.failBlock(run, blockId, dispatchResult.error ?? "Dispatch failed", blockDef);
      opts.onBlockFail?.(run, blockId, dispatchResult.error ?? "Dispatch failed");
      trace.push({
        block_id: blockId,
        instance_id: run.blocks[blockId].instance_id,
        status: "failed",
        inputs,
        outputs: {},
        pre_gates: preGates,
        post_gates: [],
        execution: null,
        duration_ms: Date.now() - startTime,
      });
      return;
    }

    // 5. Parse outputs from agent response
    const outputs = parseAgentOutputs(blockDef, dispatchResult.output ?? "");
    const durationMs = Date.now() - startTime;

    // Update runtime assignee/model to actual dispatched worker when provider reports it
    if (dispatchResult.actualAgentId) run.blocks[blockId].active_agent_id = dispatchResult.actualAgentId;
    if (dispatchResult.actualModel) run.blocks[blockId].active_model = dispatchResult.actualModel;

    const execution: BlockExecution = {
      agent_id: dispatchResult.actualAgentId ?? agent.id,
      provider: agent.provider,
      model: dispatchResult.actualModel ?? agent.model,
      raw_output: dispatchResult.output ?? "",
      tokens_in: dispatchResult.tokensUsed ?? 0,
      tokens_out: 0,
      duration_ms: durationMs,
    };

    // 6. Evaluate post-gates
    const postGates = engine.evaluatePostGates(blockDef, inputs, outputs);
    run.blocks[blockId].post_gate_results = postGates;

    const failedPostGate = postGates.find(g => !g.passed);
    if (failedPostGate) {
      execution.error = `Post-gate failed: ${failedPostGate.name}`;
      engine.failBlock(run, blockId, `Post-gate failed: ${failedPostGate.name} — ${failedPostGate.reason}`, blockDef);
      opts.onBlockFail?.(run, blockId, failedPostGate.reason ?? "Post-gate failed");
      trace.push({
        block_id: blockId,
        instance_id: run.blocks[blockId].instance_id,
        status: "failed",
        inputs,
        outputs,
        pre_gates: preGates,
        post_gates: postGates,
        execution,
        duration_ms: durationMs,
      });
      return;
    }

    // 7. Complete block
    engine.completeBlock(run, blockId, outputs, execution);
    // successful completion; bounce counters can remain for audit context
    opts.onBlockComplete?.(run, blockId);

    trace.push({
      block_id: blockId,
      instance_id: run.blocks[blockId].instance_id,
      status: "completed",
      inputs,
      outputs,
      pre_gates: preGates,
      post_gates: postGates,
      execution,
      duration_ms: durationMs,
    });
  }

  /**
   * Resolve which agent should handle a block.
   */
  function resolveAgent(blockDef: BlockDef): {
    id: string; role: string; provider: string; model: string;
  } | null {
    const ref = blockDef.agent;

    // Specific agent
    if (ref.specific) {
      const agent = opts.agents[ref.specific];
      if (!agent) return null;
      return { id: ref.specific, ...agent };
    }

    // By role + capability
    let candidates = Object.entries(opts.agents).filter(([_, a]) => {
      if (ref.role && a.role !== ref.role) return false;
      if (ref.capability && !a.capabilities.includes(ref.capability)) return false;
      return true;
    });

    // Fallback: if no exact match, try role-only, then any agent
    if (candidates.length === 0 && ref.capability) {
      candidates = Object.entries(opts.agents).filter(([_, a]) => {
        if (ref.role && a.role !== ref.role) return false;
        return true;
      });
    }
    if (candidates.length === 0) {
      // Last resort: pick any available agent
      candidates = Object.entries(opts.agents);
    }

    if (candidates.length === 0) return null;

    // Pick first match (could add load balancing later)
    const [id, agent] = candidates[0];
    return { id, ...agent };
  }

  return { execute };
}

// ── Helpers ──

function buildBlockPrompt(blockDef: BlockDef, inputs: Record<string, unknown>): string {
  const lines: string[] = [];
  lines.push(`# Block: ${blockDef.name}`);
  lines.push("");

  if (Object.keys(inputs).length > 0) {
    lines.push("## Inputs");
    for (const [key, value] of Object.entries(inputs)) {
      const desc = blockDef.inputs[key]?.description ?? "";
      lines.push(`- **${key}**${desc ? ` (${desc})` : ""}: ${JSON.stringify(value)}`);
    }
    lines.push("");
  }

  if (Object.keys(blockDef.outputs).length > 0) {
    lines.push("## Expected Outputs");
    lines.push("Respond with a JSON object containing these keys:");
    for (const [key, portDef] of Object.entries(blockDef.outputs)) {
      lines.push(`- **${key}** (${portDef.type})${portDef.description ? `: ${portDef.description}` : ""}`);
    }
    lines.push("");
  }

  if (blockDef.post_gates.length > 0) {
    lines.push("## Quality Criteria");
    for (const gate of blockDef.post_gates) {
      lines.push(`- ${gate.error}`);
    }
  }

  return lines.join("\n");
}

function parseAgentOutputs(blockDef: BlockDef, rawOutput: string): Record<string, unknown> {
  // Try to extract JSON from agent output
  const outputs: Record<string, unknown> = {};

  // Try full JSON parse first
  try {
    const parsed = JSON.parse(rawOutput);
    if (typeof parsed === "object" && parsed !== null) {
      for (const key of Object.keys(blockDef.outputs)) {
        if (key in parsed) outputs[key] = parsed[key];
      }
      if (Object.keys(outputs).length > 0) return outputs;
    }
  } catch { /* not JSON */ }

  // Try extracting JSON from markdown code blocks
  const jsonMatch = rawOutput.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
  if (jsonMatch) {
    try {
      const parsed = JSON.parse(jsonMatch[1]);
      if (typeof parsed === "object" && parsed !== null) {
        for (const key of Object.keys(blockDef.outputs)) {
          if (key in parsed) outputs[key] = parsed[key];
        }
        if (Object.keys(outputs).length > 0) return outputs;
      }
    } catch { /* not valid JSON in code block */ }
  }

  // Fallback: if single output port, use the raw output
  const outputKeys = Object.keys(blockDef.outputs);
  if (outputKeys.length === 1) {
    outputs[outputKeys[0]] = rawOutput;
  } else {
    // Last resort: stuff everything in a "raw" key if it exists, otherwise first port
    if (blockDef.outputs["raw"]) {
      outputs["raw"] = rawOutput;
    } else if (outputKeys.length > 0) {
      outputs[outputKeys[0]] = rawOutput;
    }
  }

  return outputs;
}

function inferDisplayAgentId(agentId: string, role: string, providerType?: string): string {
  // In OpenClaw-native mode, show the likely OpenClaw worker identity while block is running.
  if (providerType === "openclaw") {
    const byId: Record<string, string> = {
      coder: "rei",
      reviewer: "mari",
      manager: "main",
      specialist: "rei",
    };
    if (byId[agentId]) return byId[agentId];

    const byRole: Record<string, string> = {
      worker: "rei",
      reviewer: "mari",
      manager: "main",
      specialist: "rei",
    };
    if (byRole[role]) return byRole[role];
  }
  return agentId;
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
