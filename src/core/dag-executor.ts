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

import { createBlockEngine, evaluateBlockGate } from "./block.js";
import { runDeterministicHandler } from "./deterministic.js";
import type {
  BlockDef,
  BlockExecution,
  BlockInstance,
  DAGDef,
  DAGRun,
  GateResult,
  BlockGate,
} from "./block.js";
import type { ProviderAdapter, DispatchRequest, DispatchResult } from "../types.js";

type FailInfo = {
  code?: string;
  stage?: "dispatch" | "parse" | "contract" | "gate" | "handoff" | "timeout" | "budget" | "orphan" | "unknown";
  message?: string;
  repair?: { attempted?: boolean; succeeded?: boolean; error_message?: string };
  raw_output_preview?: string;
  provider_exit_code?: number;
  contract_trace?: {
    strict_output: boolean;
    repair_attempts_max: number;
    initial_errors: string[];
    attempts: Array<{ index: number; success: boolean; errors: string[] }>;
    final_ok: boolean;
  };
};

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
  onBlockFail?: (run: DAGRun, blockId: string, error: string, errorCode?: string, info?: FailInfo) => void;

  /** Called when the entire DAG completes */
  onRunComplete?: (run: DAGRun) => void;

  /** Called when the entire DAG fails */
  onRunFail?: (run: DAGRun) => void;

  /** Called when a block is waiting for human approval */
  onApprovalRequired?: (run: DAGRun, blockId: string, approval: Record<string, unknown>) => void;

  /** Optional approval wait primitive (event/promise-based). */
  waitForApproval?: (run: DAGRun) => Promise<void>;

  /** Max parallel blocks executing simultaneously (default: 4) */
  maxParallel?: number;

  /** Optional cancellation signal for hard stop */
  abortSignal?: AbortSignal;

  /** Optional run cancellation predicate */
  isCancelled?: () => boolean;

  /** Optional token budget caps (0/undefined = disabled). */
  budget?: {
    maxTokensPerRun?: number;
    maxTokensPerBlock?: number;
  };
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

  const isRunCancelled = (run: DAGRun): boolean =>
    (run.status as string) === "cancelled" || !!opts.isCancelled?.() || !!opts.abortSignal?.aborted;

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
    const inFlight = new Map<string, Promise<void>>();
    while (true) {
      const runStatus = run.status as DAGRun["status"];
      if (runStatus === "iterated" || runStatus === "completed" || runStatus === "failed") {
        break;
      }
      if (isRunCancelled(run)) {
        run.status = "cancelled";
        break;
      }

      // Pause loop when waiting for human approval
      if (runStatus === "paused_approval") {
        if (opts.waitForApproval) {
          await opts.waitForApproval(run);
        } else {
          await sleep(250);
        }
        continue;
      }

      // Find blocks ready to execute (excluding in-flight)
      const ready = engine.resolveReady(dag, run).filter((id) => !inFlight.has(id));

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
        if (inFlight.size > 0) {
          // Wait for one running block to finish, then re-evaluate readiness.
          await Promise.race(inFlight.values());
          continue;
        }

        const running = Object.values(run.blocks).filter(b => b.status === "running");
        if (running.length > 0) {
          // Fallback safety for any externally marked running blocks.
          await sleep(50);
          continue;
        }

        // Truly stuck — fail the run with diagnostics
        const stuck = buildStuckDiagnostics(dag, run);
        run.context.__stuck_diagnostics = stuck;
        run.context.__failure_code = "RUN_STUCK";
        run.context.__failure_reason = "No executable blocks and run is not complete";
        run.status = "failed";
        opts.onRunFail?.(run);
        break;
      }

      // Execute ready blocks with dynamic concurrency (start next as soon as one finishes).
      for (const blockId of ready) {
        if (inFlight.size >= maxParallel) break;
        const p = executeBlock(dag, run, blockId, trace)
          .catch((err) => {
            console.error(`[dag-executor] Block '${blockId}' crashed:`, err);
          })
          .finally(() => {
            inFlight.delete(blockId);
          });
        inFlight.set(blockId, p);
      }

      if (inFlight.size > 0) {
        await Promise.race(inFlight.values());
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

    if (isRunCancelled(run)) return;

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
      run.blocks[blockId].active_agent_id = agent.id;
      run.blocks[blockId].active_model = agent.model;
      run.blocks[blockId].active_provider = provider?.name ?? agent.provider;
    }

    opts.onBlockStart?.(run, blockId);

    // 2. Evaluate pre-gates
    const preGates = await evaluateGatesWithLLM(blockDef.pre_gates, {
      inputs,
      outputs: {},
      blockDef,
      defaultAgent: agent,
      providers: opts.providers,
    });
    run.blocks[blockId].pre_gate_results = preGates;

    const preMode = blockDef.gate_composition?.pre ?? "all";
    const prePassed = preGates.length === 0
      ? true
      : (preMode === "any" ? preGates.some((g) => g.passed) : preGates.every((g) => g.passed));
    const failedPreGate = preGates.find(g => !g.passed);
    if (!prePassed) {
      if (!failedPreGate) {
        engine.failBlock(run, blockId, "Pre-gate failed", blockDef);
        opts.onBlockFail?.(run, blockId, "Pre-gate failed", "PRE_GATE_FAILED", { stage: "gate", message: "Pre-gate failed" });
        return;
      }
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
          if (rule.feedback_from === "gate_verdicts") {
            run.context.gate_verdicts = {
              gate: failedPreGate.name,
              reason: failedPreGate.reason,
              audit: failedPreGate.audit ?? null,
            };
          }

          opts.onBlockFail?.(
            run,
            blockId,
            `${rule.reason ?? "Gate failure reroute"} Bounce ${bounce}/${rule.max_bounces} → rerouting to ${rule.route_to}.`,
            "GATE_FAIL_REROUTE",
            { stage: "gate", message: `${rule.reason ?? "Gate failure reroute"} Bounce ${bounce}/${rule.max_bounces} → rerouting to ${rule.route_to}.` }
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
      opts.onBlockFail?.(run, blockId, failedPreGate.reason ?? "Pre-gate failed", "PRE_GATE_FAILED", { stage: "gate", message: failedPreGate.reason ?? "Pre-gate failed" });
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

    // 3. Deterministic execution path (no provider dispatch)
    if ((blockDef.mode ?? "ai") === "deterministic") {
      if (!blockDef.deterministic?.handler) {
        const err = `Deterministic block missing handler: ${blockId}`;
        engine.failBlock(run, blockId, err, blockDef);
        opts.onBlockFail?.(run, blockId, err, "DET_CONFIG_INVALID", { stage: "dispatch", message: err });
        return;
      }

      let outputs: Record<string, unknown> = {};
      try {
        outputs = await runDeterministicHandler(blockDef.deterministic.handler, {
          inputs,
          config: blockDef.deterministic.config ?? {},
          blockId,
          runId: run.id,
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Deterministic handler failed";
        engine.failBlock(run, blockId, msg, blockDef);
        opts.onBlockFail?.(run, blockId, msg, "DET_EXEC_FAILED", { stage: "dispatch", message: msg });
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

      const contract = validateOutputContract(blockDef, outputs);
      if (!contract.ok) {
        const msg = `Output contract failed: ${contract.errors.join('; ')}`;
        engine.failBlock(run, blockId, msg, blockDef);
        opts.onBlockFail?.(run, blockId, msg, "OUTPUT_CONTRACT_FAILED", { stage: "contract", message: msg });
        return;
      }

      const execution: BlockExecution = {
        agent_id: "deterministic",
        provider: "deterministic",
        transport_provider: "deterministic",
        model: `deterministic:${blockDef.deterministic.handler}`,
        raw_output: JSON.stringify(outputs),
        tokens_in: 0,
        tokens_out: 0,
        duration_ms: Date.now() - startTime,
      };

      const postGates = await evaluateGatesWithLLM(blockDef.post_gates, {
        inputs,
        outputs,
        blockDef,
        defaultAgent: null,
        providers: opts.providers,
      });
      run.blocks[blockId].post_gate_results = postGates;
      const postMode = blockDef.gate_composition?.post ?? "all";
      const postPassed = postGates.length === 0
        ? true
        : (postMode === "any" ? postGates.some((g) => g.passed) : postGates.every((g) => g.passed));
      if (!postPassed) {
        const failedPostGate = postGates.find(g => !g.passed);
        const rule = failedPostGate ? (blockDef.on_gate_fail ?? []).find((r) => r.when_gate === failedPostGate.name) : undefined;
        if (rule && failedPostGate) {
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
            if (rule.feedback_from === "gate_verdicts") {
              run.context.gate_verdicts = {
                gate: failedPostGate.name,
                reason: failedPostGate.reason,
                audit: failedPostGate.audit ?? null,
              };
            }
            opts.onBlockFail?.(run, blockId, `Gate failure reroute Bounce ${bounce}/${rule.max_bounces} → rerouting to ${rule.route_to}.`, "GATE_FAIL_REROUTE", { stage: "gate", message: `Gate failure reroute Bounce ${bounce}/${rule.max_bounces} → rerouting to ${rule.route_to}.` });
            return;
          }
        }

        const msg = `Post-gate failed: ${failedPostGate?.name ?? "unknown"} — ${failedPostGate?.reason ?? ""}`;
        engine.failBlock(run, blockId, msg, blockDef);
        opts.onBlockFail?.(run, blockId, msg, "POST_GATE_FAILED", { stage: "gate", message: msg });
        return;
      }

      engine.completeBlock(run, blockId, outputs, execution);
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
        duration_ms: Date.now() - startTime,
      });
      return;
    }

    // 3. Ensure agent exists
    if (!agent) {
      engine.failBlock(run, blockId, `No agent found for block ${blockId}`, blockDef);
      opts.onBlockFail?.(run, blockId, "No agent found", "AGENT_NOT_FOUND", { stage: "dispatch", message: "No agent found" });
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
      opts.onBlockFail?.(run, blockId, `Provider not found: ${agent.provider}`, "PROVIDER_NOT_FOUND", { stage: "dispatch", message: `Provider not found: ${agent.provider}` });
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
      outputSchema: buildOutputJsonSchema(blockDef),
      modelParams: blockDef.agent.model_params,
      abortSignal: opts.abortSignal,
      isCancelled: opts.isCancelled,
      agent: {
        id: agent.id,
        role: agent.role,
        model: agent.model,
      },
    };
    run.blocks[blockId].active_schema_guided = !!dispatchRequest.outputSchema;

    let dispatchResult: DispatchResult;
    try {
      dispatchResult = await dispatchWithTimeout(provider, dispatchRequest, blockDef.timeout_ms);
    } catch (err) {
      const error = err instanceof Error ? err.message : "Unknown dispatch error";
      if (isRunCancelled(run)) {
        run.blocks[blockId].status = "skipped";
        return;
      }
      engine.failBlock(run, blockId, error, blockDef);
      const timeoutHit = /timed out/i.test(error);
      opts.onBlockFail?.(run, blockId, error, timeoutHit ? "DISPATCH_TIMEOUT" : "DISPATCH_EXCEPTION", {
        stage: timeoutHit ? "timeout" : "dispatch",
        message: error,
      });
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
      if (isRunCancelled(run)) {
        run.blocks[blockId].status = "skipped";
        return;
      }
      engine.failBlock(run, blockId, dispatchResult.error ?? "Dispatch failed", blockDef);
      opts.onBlockFail?.(run, blockId, dispatchResult.error ?? "Dispatch failed", "DISPATCH_FAILED", { stage: "dispatch", message: dispatchResult.error ?? "Dispatch failed" });
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
    let outputs = parseAgentOutputs(blockDef, dispatchResult.output ?? "");
    let durationMs = Date.now() - startTime;

    // Enforce output contract at core level (configurable deterministic repair loop)
    const strictOutput = blockDef.strict_output !== false;
    const repairAttemptsMax = Math.max(0, Math.min(3, Number(blockDef.contract_repair_attempts ?? 1)));
    let contract = validateOutputContract(blockDef, outputs);
    const contractTrace: NonNullable<FailInfo["contract_trace"]> = {
      strict_output: strictOutput,
      repair_attempts_max: repairAttemptsMax,
      initial_errors: contract.ok ? [] : [...contract.errors],
      attempts: [],
      final_ok: contract.ok,
    };

    if (strictOutput && !contract.ok) {
      for (let attempt = 1; attempt <= repairAttemptsMax && !contract.ok; attempt++) {
        const repairRequest: DispatchRequest = {
          ...dispatchRequest,
          description: buildRepairPrompt(blockDef, dispatchResult.output ?? "", contract.errors),
        };

        let attemptErrors: string[] = [];
        try {
          const repairResult = await dispatchWithTimeout(provider, repairRequest, blockDef.timeout_ms);
          if (repairResult.success) {
            dispatchResult = repairResult;
            outputs = parseAgentOutputs(blockDef, dispatchResult.output ?? "");
            durationMs = Date.now() - startTime;
            contract = validateOutputContract(blockDef, outputs);
            attemptErrors = contract.ok ? [] : [...contract.errors];
          } else {
            attemptErrors = [repairResult.error ?? "repair dispatch failed"];
          }
        } catch (err) {
          attemptErrors = [err instanceof Error ? err.message : "repair dispatch exception"];
        }

        contractTrace.attempts.push({
          index: attempt,
          success: contract.ok,
          errors: attemptErrors,
        });
      }
    }

    contractTrace.final_ok = contract.ok;

    if (strictOutput && !contract.ok) {
      const err = `Output contract failed: ${contract.errors.join("; ")}`;
      const execution: BlockExecution = {
        agent_id: dispatchResult.actualAgentId ?? agent.id,
        provider: dispatchResult.actualModelProvider ?? dispatchResult.actualProvider ?? agent.provider,
        transport_provider: dispatchResult.actualProvider ?? agent.provider,
        model: dispatchResult.actualModel ?? agent.model,
        raw_output: dispatchResult.output ?? "",
        tokens_in: dispatchResult.tokensUsed ?? 0,
        tokens_out: 0,
        duration_ms: durationMs,
        error: err,
      };
      (execution as unknown as Record<string, unknown>).contract_trace = contractTrace;
      engine.failBlock(run, blockId, err, blockDef);
      opts.onBlockFail?.(run, blockId, err, "OUTPUT_CONTRACT_FAILED", {
        stage: "contract",
        message: err,
        repair: { attempted: contractTrace.attempts.length > 0, succeeded: contract.ok || (dispatchResult.repairSucceeded ?? false) },
        raw_output_preview: (dispatchResult.output ?? "").slice(0, 400),
        contract_trace: contractTrace,
      });
      trace.push({
        block_id: blockId,
        instance_id: run.blocks[blockId].instance_id,
        status: "failed",
        inputs,
        outputs,
        pre_gates: preGates,
        post_gates: [],
        execution,
        duration_ms: durationMs,
      });
      return;
    }

    // Update runtime assignee/model/provider to actual dispatched worker when provider reports it
    if (dispatchResult.actualAgentId) run.blocks[blockId].active_agent_id = dispatchResult.actualAgentId;
    if (dispatchResult.actualModel) run.blocks[blockId].active_model = dispatchResult.actualModel;
    if (dispatchResult.actualProvider || dispatchResult.actualModelProvider) {
      run.blocks[blockId].active_provider = dispatchResult.actualModelProvider ?? dispatchResult.actualProvider;
    }

    const execution: BlockExecution = {
      agent_id: dispatchResult.actualAgentId ?? agent.id,
      provider: dispatchResult.actualModelProvider ?? dispatchResult.actualProvider ?? agent.provider,
      transport_provider: dispatchResult.actualProvider ?? agent.provider,
      model: dispatchResult.actualModel ?? agent.model,
      raw_output: dispatchResult.output ?? "",
      tokens_in: dispatchResult.tokensUsed ?? 0,
      tokens_out: 0,
      duration_ms: durationMs,
    };

    if (typeof dispatchResult.repairAttempted === "boolean" || typeof dispatchResult.repairSucceeded === "boolean") {
      (execution as unknown as Record<string, unknown>).structured_repair = {
        attempted: dispatchResult.repairAttempted ?? false,
        succeeded: dispatchResult.repairSucceeded ?? false,
      };
    }
    if (strictOutput) {
      (execution as unknown as Record<string, unknown>).contract_trace = contractTrace;
    }

    // 5.5 Enforce token budgets (if configured)
    const blockTokens = Number(execution.tokens_in ?? 0) + Number(execution.tokens_out ?? 0);
    const maxPerBlock = Number(opts.budget?.maxTokensPerBlock ?? 0);
    if (Number.isFinite(maxPerBlock) && maxPerBlock > 0 && blockTokens > maxPerBlock) {
      const err = `Token budget exceeded for block ${blockId}: ${blockTokens} > ${maxPerBlock}`;
      execution.error = err;
      engine.failBlock(run, blockId, err, blockDef);
      opts.onBlockFail?.(run, blockId, err, "BUDGET_EXCEEDED", { stage: "budget", message: err });
      trace.push({
        block_id: blockId,
        instance_id: run.blocks[blockId].instance_id,
        status: "failed",
        inputs,
        outputs,
        pre_gates: preGates,
        post_gates: [],
        execution,
        duration_ms: durationMs,
      });
      return;
    }

    const maxPerRun = Number(opts.budget?.maxTokensPerRun ?? 0);
    if (Number.isFinite(maxPerRun) && maxPerRun > 0) {
      const currentRunTokens = Object.values(run.blocks).reduce((sum, b) => {
        if (!b.execution) return sum;
        return sum + Number(b.execution.tokens_in ?? 0) + Number(b.execution.tokens_out ?? 0);
      }, 0) + blockTokens;
      if (currentRunTokens > maxPerRun) {
        const err = `Run token budget exceeded: ${currentRunTokens} > ${maxPerRun}`;
        execution.error = err;
        engine.failBlock(run, blockId, err, blockDef);
        opts.onBlockFail?.(run, blockId, err, "BUDGET_EXCEEDED", { stage: "budget", message: err });
        trace.push({
          block_id: blockId,
          instance_id: run.blocks[blockId].instance_id,
          status: "failed",
          inputs,
          outputs,
          pre_gates: preGates,
          post_gates: [],
          execution,
          duration_ms: durationMs,
        });
        return;
      }
    }

    // 6. Evaluate post-gates
    const postGates = await evaluateGatesWithLLM(blockDef.post_gates, {
      inputs,
      outputs,
      blockDef,
      defaultAgent: agent,
      providers: opts.providers,
    });
    run.blocks[blockId].post_gate_results = postGates;

    const postMode = blockDef.gate_composition?.post ?? "all";
    const postPassed = postGates.length === 0
      ? true
      : (postMode === "any" ? postGates.some((g) => g.passed) : postGates.every((g) => g.passed));
    const failedPostGate = postGates.find(g => !g.passed);
    if (!postPassed) {
      if (!failedPostGate) {
        execution.error = "Post-gate failed";
        engine.failBlock(run, blockId, "Post-gate failed", blockDef);
        opts.onBlockFail?.(run, blockId, "Post-gate failed", "POST_GATE_FAILED", { stage: "gate", message: "Post-gate failed" });
        return;
      }
      const rule = (blockDef.on_gate_fail ?? []).find((r) => r.when_gate === failedPostGate.name);
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
          if (rule.feedback_from === "gate_verdicts") {
            run.context.gate_verdicts = {
              gate: failedPostGate.name,
              reason: failedPostGate.reason,
              audit: failedPostGate.audit ?? null,
            };
          }
          opts.onBlockFail?.(
            run,
            blockId,
            `${rule.reason ?? "Gate failure reroute"} Bounce ${bounce}/${rule.max_bounces} → rerouting to ${rule.route_to}.`,
            "GATE_FAIL_REROUTE",
            { stage: "gate", message: `${rule.reason ?? "Gate failure reroute"} Bounce ${bounce}/${rule.max_bounces} → rerouting to ${rule.route_to}.` }
          );
          return;
        }
      }

      execution.error = `Post-gate failed: ${failedPostGate.name}`;
      engine.failBlock(run, blockId, `Post-gate failed: ${failedPostGate.name} — ${failedPostGate.reason}`, blockDef);
      opts.onBlockFail?.(run, blockId, failedPostGate.reason ?? "Post-gate failed", "POST_GATE_FAILED", { stage: "gate", message: failedPostGate.reason ?? "Post-gate failed" });
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

    // 7.5 Handoff readiness check: ensure downstream required inputs remain satisfiable
    const handoff = evaluateDownstreamSatisfiable(dag, run, blockId);
    if (!handoff.ok) {
      const err = `Handoff unsatisfied: ${handoff.errors.join('; ')}`;
      run.status = "failed";
      opts.onBlockFail?.(run, blockId, err, "HANDOFF_UNSATISFIABLE", {
        stage: "handoff",
        message: err,
      });
      opts.onRunFail?.(run);
      trace.push({
        block_id: blockId,
        instance_id: run.blocks[blockId].instance_id,
        status: "failed",
        inputs,
        outputs,
        pre_gates: preGates,
        post_gates: postGates,
        execution: { ...execution, error: err },
        duration_ms: durationMs,
      });
      return;
    }

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

function evaluateDownstreamSatisfiable(dag: DAGDef, run: DAGRun, fromBlockId: string): { ok: boolean; errors: string[] } {
  const errors: string[] = [];
  const outgoing = dag.edges.filter(e => e.from === fromBlockId);
  const downstreamIds = [...new Set(outgoing.map(e => e.to))];

  for (const downId of downstreamIds) {
    const downDef = dag.blocks.find(b => b.id === downId);
    if (!downDef) continue;

    for (const [portName, portDef] of Object.entries(downDef.inputs)) {
      if (portDef.required === false) continue;

      // default value or context can satisfy required input
      if (Object.prototype.hasOwnProperty.call(portDef, "default")) continue;
      if (Object.prototype.hasOwnProperty.call(run.context, portName)) continue;

      const sourceEdges = dag.edges.filter(e => e.to === downId && e.input === portName);
      if (sourceEdges.length === 0) {
        errors.push(`${downId}.${portName} has no source/default/context`);
        continue;
      }

      let satisfiable = false;
      for (const edge of sourceEdges) {
        const sourceInst = run.blocks[edge.from];
        if (!sourceInst) continue;

        if (sourceInst.status === "completed" && Object.prototype.hasOwnProperty.call(sourceInst.outputs, edge.output)) {
          satisfiable = true;
          break;
        }

        if (["pending", "ready", "running", "retrying"].includes(sourceInst.status)) {
          satisfiable = true;
          break;
        }
      }

      if (!satisfiable) {
        errors.push(`${downId}.${portName} unsatisfied (all sources terminal/missing)`);
      }
    }
  }

  return { ok: errors.length === 0, errors };
}

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
    lines.push("Respond with ONLY valid JSON (no markdown, no prose) containing these keys:");
    for (const [key, portDef] of Object.entries(blockDef.outputs)) {
      lines.push(`- **${key}** (${portDef.type})${portDef.description ? `: ${portDef.description}` : ""}`);
    }
    lines.push("");
    lines.push("## JSON Shape Example");
    lines.push("Use this exact top-level key structure (replace placeholder values):");
    lines.push("```json");
    lines.push(JSON.stringify(buildOutputTemplate(blockDef), null, 2));
    lines.push("```");
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

function validateOutputContract(blockDef: BlockDef, outputs: Record<string, unknown>): { ok: boolean; errors: string[] } {
  const errors: string[] = [];

  for (const [key, def] of Object.entries(blockDef.outputs)) {
    const value = outputs[key];
    const required = def.required !== false;

    if (required && (value === undefined || value === null || (typeof value === "string" && value.trim() === ""))) {
      errors.push(`missing required output '${key}'`);
      continue;
    }

    if (value === undefined || value === null) continue;

    const typeOk =
      (def.type === "string" && typeof value === "string") ||
      (def.type === "number" && typeof value === "number") ||
      (def.type === "boolean" && typeof value === "boolean") ||
      (def.type === "json" && (typeof value === "object" || Array.isArray(value))) ||
      ((def.type === "file" || def.type === "artifact") && typeof value === "string");

    if (!typeOk) {
      errors.push(`output '${key}' expected type '${def.type}'`);
    }
  }

  return { ok: errors.length === 0, errors };
}

function buildRepairPrompt(blockDef: BlockDef, _rawOutput: string, errors: string[]): string {
  const required = Object.entries(blockDef.outputs)
    .filter(([_, d]) => d.required !== false)
    .map(([k, d]) => `${k}:${d.type}`)
    .join(", ");

  return [
    `Your previous response failed output contract validation.`,
    `Errors: ${errors.join("; ")}`,
    `Return ONLY valid JSON (no markdown, no prose).`,
    `Do NOT include explanations or restate instructions.`,
    `Required outputs: ${required}`,
    `JSON shape example:`,
    JSON.stringify(buildOutputTemplate(blockDef), null, 2),
  ].join("\n");
}

function buildOutputTemplate(blockDef: BlockDef): Record<string, unknown> {
  const template: Record<string, unknown> = {};
  for (const [key, def] of Object.entries(blockDef.outputs)) {
    switch (def.type) {
      case "string":
      case "file":
      case "artifact":
        template[key] = "<string>";
        break;
      case "number":
        template[key] = 0;
        break;
      case "boolean":
        template[key] = true;
        break;
      case "json":
      default:
        template[key] = { example: true };
        break;
    }
  }
  return template;
}

function buildOutputJsonSchema(blockDef: BlockDef): Record<string, unknown> {
  const properties: Record<string, unknown> = {};
  const required: string[] = [];

  for (const [key, def] of Object.entries(blockDef.outputs)) {
    if (def.required !== false) required.push(key);
    const type =
      def.type === "string" || def.type === "file" || def.type === "artifact"
        ? "string"
        : def.type === "number"
        ? "number"
        : def.type === "boolean"
        ? "boolean"
        : "object";
    properties[key] = { type, description: def.description ?? "" };
  }

  return {
    type: "object",
    additionalProperties: false,
    properties,
    required,
  };
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

function buildStuckDiagnostics(dag: DAGDef, run: DAGRun): Record<string, unknown> {
  const blocked = dag.blocks
    .filter((b) => {
      const st = run.blocks[b.id]?.status;
      return st !== "completed" && st !== "failed" && st !== "skipped";
    })
    .map((b) => {
      const wiredInputs = run.blocks[b.id]?.inputs ?? {};
      const missingRequiredInputs = Object.entries(b.inputs)
        .filter(([name, def]) => Boolean((def as { required?: boolean }).required) && !Object.prototype.hasOwnProperty.call(wiredInputs, name))
        .map(([name]) => name);

      const unmetUpstream = dag.edges
        .filter((e) => e.to === b.id)
        .filter((e) => run.blocks[e.from]?.status !== "completed")
        .map((e) => ({ from: e.from, output: e.output, input: e.input, upstream_status: run.blocks[e.from]?.status ?? "unknown" }));

      return {
        block_id: b.id,
        status: run.blocks[b.id]?.status ?? "unknown",
        missing_required_inputs: missingRequiredInputs,
        unmet_upstream: unmetUpstream,
      };
    });

  return {
    blocked_count: blocked.length,
    blocked,
    timestamp: new Date().toISOString(),
  };
}

async function evaluateGatesWithLLM(
  gates: BlockGate[],
  ctx: {
    inputs: Record<string, unknown>;
    outputs: Record<string, unknown>;
    blockDef: BlockDef;
    defaultAgent: { id: string; role: string; provider: string; model: string } | null;
    providers: Record<string, ProviderAdapter>;
  }
): Promise<GateResult[]> {
  const results: GateResult[] = [];

  for (const gate of gates) {
    if (gate.check.type !== "llm_review") {
      results.push(evaluateBlockGate(gate, ctx.inputs, ctx.outputs));
      continue;
    }

    const ports = { ...ctx.inputs, ...ctx.outputs };
    const candidate = ports[gate.check.port];
    if (candidate === undefined || candidate === null || String(candidate).trim() === "") {
      results.push({
        name: gate.name,
        passed: false,
        reason: `${gate.error} (target port '${gate.check.port}' is empty)`,
        audit: { gate_type: "llm_review", status: "failed", failure: "empty_port" },
      });
      continue;
    }

    const providerName = gate.check.provider ?? ctx.defaultAgent?.provider;
    const provider = providerName ? ctx.providers[providerName] : undefined;
    if (!providerName || !provider) {
      results.push({
        name: gate.name,
        passed: false,
        reason: `${gate.error} (llm_review provider not found: ${providerName ?? "<none>"})`,
        audit: { gate_type: "llm_review", status: "failed", failure: "provider_not_found", provider: providerName ?? null },
      });
      continue;
    }

    const model = gate.check.model ?? ctx.defaultAgent?.model ?? "unknown";
    const criteria = gate.check.criteria;
    const passThreshold = Number(gate.check.pass_threshold ?? 1);

    const systemPrompt = gate.check.system_prompt ?? "You are a strict quality reviewer.";
    const reviewPrompt = [
      "Evaluate the following output against each criterion.",
      "Respond with ONLY valid JSON array; each element must have: criterion, passed (boolean), reasoning.",
      "",
      "OUTPUT:",
      "---",
      String(candidate),
      "---",
      "",
      "CRITERIA:",
      ...criteria.map((c, i) => `${i + 1}. ${c}`),
      "",
      "Example:",
      '[{"criterion":"Code handles errors","passed":true,"reasoning":"Try/catch present."}]',
    ].join("\n");

    const reviewStart = Date.now();
    try {
      const reviewReq: DispatchRequest = {
        taskId: `gate_${ctx.blockDef.id}_${gate.name}`,
        pipeline: "llm_review",
        title: `LLM Review: ${ctx.blockDef.name}/${gate.name}`,
        system: systemPrompt,
        description: reviewPrompt,
        context: {
          gate_type: "llm_review",
          block_id: ctx.blockDef.id,
          gate_name: gate.name,
        },
        acceptanceCriteria: criteria,
        bounceCount: 0,
        abortSignal: undefined,
        isCancelled: undefined,
        agent: {
          id: ctx.defaultAgent?.id ?? "reviewer",
          role: "reviewer",
          model,
        },
      };

      const review = await dispatchWithTimeout(provider, reviewReq, gate.check.timeout_ms ?? 15000);
      if (!review.success) {
        results.push({
          name: gate.name,
          passed: false,
          reason: `${gate.error} (review dispatch failed: ${review.error ?? "unknown"})`,
          audit: {
            gate_type: "llm_review",
            status: "failed",
            failure: "dispatch_failed",
            provider: providerName,
            model,
            criteria_count: criteria.length,
            pass_threshold: passThreshold,
            review_prompt: reviewPrompt,
            raw_response: review.output ?? "",
            tokens_used: review.tokensUsed ?? 0,
            duration_ms: Date.now() - reviewStart,
          },
        });
        continue;
      }

      const parsed = parseReviewJson(review.output ?? "");
      if (!parsed.ok) {
        results.push({
          name: gate.name,
          passed: false,
          reason: `${gate.error} (review output invalid JSON schema)` ,
          audit: {
            gate_type: "llm_review",
            status: "failed",
            failure: "invalid_review_output",
            provider: providerName,
            model,
            raw_preview: String(review.output ?? "").slice(0, 400),
          },
        });
        continue;
      }

      const passedCount = parsed.criteria.filter((c) => c.passed).length;
      const score = parsed.criteria.length === 0 ? 0 : passedCount / parsed.criteria.length;
      const ok = score >= passThreshold;

      results.push({
        name: gate.name,
        passed: ok,
        reason: ok ? undefined : `${gate.error} (${passedCount}/${parsed.criteria.length} criteria passed)` ,
        audit: {
          gate_type: "llm_review",
          status: ok ? "passed" : "failed",
          provider: providerName,
          model,
          pass_threshold: passThreshold,
          score,
          passed_count: passedCount,
          criteria_count: parsed.criteria.length,
          overall_passed: ok,
          verdicts: parsed.criteria,
          summary: parsed.summary,
          review_prompt: reviewPrompt,
          raw_response: review.output ?? "",
          tokens_used: review.tokensUsed ?? 0,
          duration_ms: Date.now() - reviewStart,
        },
      });
    } catch (err) {
      results.push({
        name: gate.name,
        passed: false,
        reason: `${gate.error} (${err instanceof Error ? err.message : "review exception"})`,
        audit: {
          gate_type: "llm_review",
          status: "failed",
          failure: "exception",
          provider: providerName,
          model,
        },
      });
    }
  }

  return results;
}

function parseReviewJson(raw: string): { ok: true; criteria: Array<{ criterion: string; passed: boolean; reasoning: string }>; summary?: string } | { ok: false } {
  const candidates: string[] = [raw];
  const code = raw.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
  if (code?.[1]) candidates.push(code[1]);

  for (const candidate of candidates) {
    try {
      const parsedAny = JSON.parse(candidate) as unknown;
      const parsed = parsedAny as Record<string, unknown>;

      const arr = Array.isArray(parsedAny)
        ? parsedAny
        : (Array.isArray(parsed?.criteria) ? parsed.criteria : null);
      if (!arr) continue;

      const criteria = arr
        .map((c) => c as Record<string, unknown>)
        .filter((c) => typeof c.criterion === "string" && typeof c.passed === "boolean")
        .map((c) => ({
          criterion: String(c.criterion),
          passed: Boolean(c.passed),
          reasoning: typeof c.reasoning === "string"
            ? c.reasoning
            : (typeof c.reason === "string" ? c.reason : ""),
        }));
      if (criteria.length === 0) continue;

      const summary = !Array.isArray(parsedAny) && typeof parsed.summary === "string" ? parsed.summary : undefined;
      return { ok: true, criteria, summary };
    } catch {
      // try next candidate
    }
  }

  return { ok: false };
}

async function dispatchWithTimeout(
  provider: ProviderAdapter,
  request: DispatchRequest,
  timeoutMs?: number
): Promise<DispatchResult> {
  const effectiveTimeout = Number(timeoutMs ?? 0);
  if (!Number.isFinite(effectiveTimeout) || effectiveTimeout <= 0) {
    return provider.dispatch(request);
  }

  const ctl = new AbortController();
  const relayAbort = () => ctl.abort(request.abortSignal?.reason ?? "upstream abort");
  request.abortSignal?.addEventListener("abort", relayAbort, { once: true });

  const timer = setTimeout(() => {
    ctl.abort(`dispatch timed out after ${effectiveTimeout}ms`);
  }, effectiveTimeout);

  try {
    return await provider.dispatch({ ...request, abortSignal: ctl.signal });
  } catch (err) {
    if (ctl.signal.aborted && String(ctl.signal.reason ?? "").includes("timed out")) {
      throw new Error(String(ctl.signal.reason));
    }
    throw err;
  } finally {
    clearTimeout(timer);
    request.abortSignal?.removeEventListener("abort", relayAbort);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
