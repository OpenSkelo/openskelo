/**
 * DAG API — endpoints + SSE for real-time DAG execution.
 */

import { Hono } from "hono";
import { cors } from "hono/cors";
import { streamSSE } from "hono/streaming";
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { parseYamlWithDiagnostics } from "../core/yaml-utils.js";
import { createBlockEngine } from "../core/block.js";
import { createDAGExecutor } from "../core/dag-executor.js";
import { createOpenClawProvider } from "../core/openclaw-provider.js";
import { createMockProvider } from "../core/mock-provider.js";
import { createOllamaProvider } from "../core/ollama-provider.js";
import { createOpenAICompatibleProvider } from "../core/openai-compatible-provider.js";
import { createDB, getDB } from "../core/db.js";
import { getProviderToken } from "../core/auth.js";
import { toSkeloError } from "../core/errors.js";
import { jsonError } from "./dag-api-errors.js";
import { buildApprovalNotificationText } from "./dag-api-approval-text.js";
import type { DAGDef, DAGRun, BlockInstance } from "../core/block.js";
import type { ExecutorResult, TraceEntry } from "../core/dag-executor.js";
import type { SkeloConfig, ProviderAdapter } from "../types.js";

interface DAGEvent {
  type: "run:start" | "block:start" | "block:complete" | "block:fail" | "run:complete" | "run:fail" | "run:iterated" | "approval:requested" | "approval:decided";
  run_id: string;
  block_id?: string;
  data: Record<string, unknown>;
  timestamp: string;
  seq?: number;
}

// In-memory store for active runs + events
const activeRuns = new Map<string, { dag: DAGDef; run: DAGRun; result?: ExecutorResult }>();
const runAbortControllers = new Map<string, AbortController>();
const runSafetyTimers = new Map<string, NodeJS.Timeout>();
const runStallTimers = new Map<string, NodeJS.Timeout>();
const runEvents = new Map<string, DAGEvent[]>();
const sseClients = new Map<string, Set<(event: DAGEvent) => void>>();
const sseClientRegistry = new Map<string, Map<string, (event: DAGEvent) => void>>();
const approvalWaiters = new Map<string, Set<() => void>>();
const runStallCounts = new Map<string, number>();

export function createDAGAPI(config: SkeloConfig, opts?: { examplesDir?: string }) {
  // Isolate state per API instance (important for tests/restarts)
  for (const t of runSafetyTimers.values()) clearTimeout(t);
  for (const t of runStallTimers.values()) clearTimeout(t);
  for (const ctl of runAbortControllers.values()) {
    if (!ctl.signal.aborted) ctl.abort("dag-api reinit");
  }
  activeRuns.clear();
  runAbortControllers.clear();
  runSafetyTimers.clear();
  runStallTimers.clear();
  runEvents.clear();
  sseClients.clear();
  sseClientRegistry.clear();
  approvalWaiters.clear();
  runStallCounts.clear();

  const app = new Hono();
  app.use("/api/dag/*", cors());
  const engine = createBlockEngine();
  const examplesBaseDir = opts?.examplesDir ?? resolve(process.cwd(), "examples");

  const safety = {
    maxConcurrentRuns: Number(process.env.OPENSKELO_MAX_CONCURRENT_RUNS ?? "2"),
    maxRunDurationMs: Number(process.env.OPENSKELO_MAX_RUN_DURATION_MS ?? String(30 * 60 * 1000)),
    maxBlockDurationMs: Number(process.env.OPENSKELO_MAX_BLOCK_DURATION_MS ?? String(10 * 60 * 1000)),
    maxRetriesCap: Number(process.env.OPENSKELO_MAX_RETRIES_CAP ?? "2"),
    stallTimeoutMs: Number(process.env.OPENSKELO_STALL_TIMEOUT_MS ?? String(5 * 60 * 1000)),
    orphanTimeoutMs: Number(process.env.OPENSKELO_ORPHAN_TIMEOUT_MS ?? String(2 * 60 * 1000)),
    queueLeaseMs: Number(process.env.OPENSKELO_QUEUE_LEASE_MS ?? "30000"),
  };

  // Phase A durability: persist DAG runs/events/approvals
  createDB();
  const db = getDB();
  const upsertDagRun = db.prepare(`
    INSERT INTO dag_runs (id, dag_name, status, dag_json, run_json, trace_json, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      status=excluded.status,
      run_json=excluded.run_json,
      trace_json=excluded.trace_json,
      updated_at=excluded.updated_at
  `);
  const insertDagEvent = db.prepare(`
    INSERT INTO dag_events (id, run_id, event_type, block_id, data_json, timestamp)
    VALUES (?, ?, ?, ?, ?, ?)
  `);
  const selectDagEventsSince = db.prepare(`
    SELECT rowid as seq, run_id, event_type, block_id, data_json, timestamp
    FROM dag_events
    WHERE run_id = ? AND rowid > ?
    ORDER BY rowid ASC
  `);
  const upsertDagApproval = db.prepare(`
    INSERT INTO dag_approvals (token, run_id, block_id, status, prompt, approver, requested_at, decided_at, notes, payload_json)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(token) DO UPDATE SET
      status=excluded.status,
      decided_at=excluded.decided_at,
      notes=excluded.notes,
      payload_json=excluded.payload_json
  `);

  const upsertQueueEntry = db.prepare(`
    INSERT INTO dag_run_queue (run_id, status, priority, manual_rank, claim_owner, claim_token, lease_expires_at, attempt, payload_json, last_error, created_at, updated_at, started_at, finished_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(run_id) DO UPDATE SET
      status=excluded.status,
      priority=excluded.priority,
      manual_rank=excluded.manual_rank,
      claim_owner=excluded.claim_owner,
      claim_token=excluded.claim_token,
      lease_expires_at=excluded.lease_expires_at,
      attempt=excluded.attempt,
      payload_json=excluded.payload_json,
      last_error=excluded.last_error,
      updated_at=excluded.updated_at,
      started_at=excluded.started_at,
      finished_at=excluded.finished_at
  `);
  const selectQueueByRun = db.prepare(`SELECT * FROM dag_run_queue WHERE run_id = ?`);
  const selectQueueOrdered = db.prepare(`
    SELECT run_id, status, priority, manual_rank, claim_owner, claim_token, lease_expires_at, attempt, last_error, created_at, updated_at, started_at, finished_at
    FROM dag_run_queue
    ORDER BY
      CASE WHEN status = 'pending' THEN 0 WHEN status = 'claimed' THEN 1 WHEN status = 'running' THEN 2 ELSE 3 END ASC,
      CASE WHEN manual_rank IS NULL THEN 1 ELSE 0 END ASC,
      manual_rank ASC,
      priority DESC,
      created_at ASC
  `);
  const releaseExpiredClaims = db.prepare(`
    UPDATE dag_run_queue
    SET status = 'pending',
        claim_owner = NULL,
        claim_token = NULL,
        lease_expires_at = NULL,
        updated_at = ?
    WHERE status = 'claimed' AND lease_expires_at IS NOT NULL AND lease_expires_at < ?
  `);
  const selectNextPendingForClaim = db.prepare(`
    SELECT run_id, status, priority, manual_rank, claim_owner, claim_token, lease_expires_at, attempt, payload_json, created_at, updated_at, started_at, finished_at
    FROM dag_run_queue
    WHERE status = 'pending'
    ORDER BY
      CASE WHEN manual_rank IS NULL THEN 1 ELSE 0 END ASC,
      manual_rank ASC,
      priority DESC,
      created_at ASC
    LIMIT 1
  `);
  const claimQueueEntry = db.prepare(`
    UPDATE dag_run_queue
    SET status = 'claimed',
        claim_owner = ?,
        claim_token = ?,
        lease_expires_at = ?,
        updated_at = ?
    WHERE run_id = ? AND status = 'pending'
  `);
  const markQueueRunning = db.prepare(`
    UPDATE dag_run_queue
    SET status = 'running',
        claim_owner = ?,
        claim_token = ?,
        lease_expires_at = ?,
        started_at = COALESCE(started_at, ?),
        updated_at = ?
    WHERE run_id = ? AND status IN ('claimed', 'pending')
  `);
  const markQueueFinished = db.prepare(`
    UPDATE dag_run_queue
    SET status = ?,
        lease_expires_at = NULL,
        claim_owner = NULL,
        claim_token = NULL,
        last_error = ?,
        finished_at = ?,
        updated_at = ?
    WHERE run_id = ?
  `);

  async function notifyApprovalViaTelegram(run: DAGRun, approval: Record<string, unknown>): Promise<void> {
    const target = String(process.env.OPENSKELO_APPROVAL_TELEGRAM_TARGET ?? "").trim();
    if (!target) {
      console.warn("[dag-api] approval notify skipped: OPENSKELO_APPROVAL_TELEGRAM_TARGET is not set");
      return;
    }

    const text = buildApprovalNotificationText(run, approval);

    await runCommand("openclaw", [
      "message",
      "send",
      "--channel", "telegram",
      "--target", target,
      "--message", text,
    ], 20).catch((err) => {
      console.error("[dag-api] Telegram approval notify failed:", err instanceof Error ? err.message : err);
    });
  }

  function persistRunSnapshot(entry: { dag: DAGDef; run: DAGRun; result?: ExecutorResult }) {
    upsertDagRun.run(
      entry.run.id,
      entry.dag.name,
      entry.run.status,
      JSON.stringify(entry.dag),
      JSON.stringify(entry.run),
      JSON.stringify(entry.result?.trace ?? []),
      entry.run.created_at,
      new Date().toISOString()
    );
  }

  function normalizePriority(raw: unknown): number {
    if (typeof raw === "number" && Number.isFinite(raw)) return Math.trunc(raw);
    const text = String(raw ?? "").trim().toUpperCase();
    if (!text) return 0;
    if (text === "P0" || text === "URGENT") return 30;
    if (text === "P1" || text === "HIGH") return 20;
    if (text === "P2" || text === "MEDIUM") return 10;
    if (text === "P3" || text === "LOW") return 0;
    const asNum = Number(text);
    return Number.isFinite(asNum) ? Math.trunc(asNum) : 0;
  }

  function parseManualRank(raw: unknown): number | null {
    if (raw === null || raw === undefined || raw === "") return null;
    const n = Number(raw);
    if (!Number.isFinite(n)) return null;
    return Math.trunc(n);
  }

  function getActiveRunningCount(): number {
    return Array.from(activeRuns.values()).filter((e) => e.run.status === "running" || e.run.status === "paused_approval" || e.run.status === "pending").length;
  }

  function markQueueRunFinal(runId: string, status: "completed" | "failed" | "cancelled", error?: string): void {
    const now = new Date().toISOString();
    markQueueFinished.run(status, error ?? null, now, now, runId);
  }

  type QueueClaim = {
    run_id: string;
    claim_token: string;
    payload_json: string;
  };

  const claimNextQueuedRun = db.transaction((claimOwner: string, nowIso: string, leaseMs: number): QueueClaim | null => {
    releaseExpiredClaims.run(nowIso, nowIso);

    const candidate = selectNextPendingForClaim.get() as Record<string, unknown> | undefined;
    if (!candidate) return null;

    const runId = String(candidate.run_id ?? "");
    if (!runId) return null;

    const claimToken = `qcl_${runId}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
    const leaseExpires = new Date(Date.now() + leaseMs).toISOString();
    const result = claimQueueEntry.run(claimOwner, claimToken, leaseExpires, nowIso, runId);
    if (Number(result.changes ?? 0) !== 1) return null;

    const claimed = selectQueueByRun.get(runId) as Record<string, unknown> | undefined;
    if (!claimed) return null;

    return {
      run_id: runId,
      claim_token: claimToken,
      payload_json: String(claimed.payload_json ?? "{}"),
    };
  });

  let queuePumpActive = false;
  let queuePumpRequested = false;

  async function pumpQueuedRuns(reason: string): Promise<void> {
    if (queuePumpActive) {
      queuePumpRequested = true;
      return;
    }
    queuePumpActive = true;
    try {
      do {
        queuePumpRequested = false;

        while (getActiveRunningCount() < safety.maxConcurrentRuns) {
          const claim = claimNextQueuedRun(`dag-api:${reason}`, new Date().toISOString(), safety.queueLeaseMs);
          if (!claim) break;

          let payload: Record<string, unknown>;
          try {
            payload = JSON.parse(claim.payload_json) as Record<string, unknown>;
          } catch (err) {
            markQueueRunFinal(claim.run_id, "failed", `Invalid queue payload: ${err instanceof Error ? err.message : String(err)}`);
            continue;
          }

          const dag = payload.dag as DAGDef | undefined;
          const context = (payload.context as Record<string, unknown> | undefined) ?? {};
          const body = (payload.body as Record<string, unknown> | undefined) ?? {};

          if (!dag || typeof dag !== "object") {
            markQueueRunFinal(claim.run_id, "failed", "Invalid queued DAG payload");
            continue;
          }

          const now = new Date().toISOString();
          markQueueRunning.run(`dag-api:${reason}`, claim.claim_token, new Date(Date.now() + safety.queueLeaseMs).toISOString(), now, now, claim.run_id);

          void startDagExecution(dag, context, body, {
            skipConcurrencyGate: true,
            queuedRunId: claim.run_id,
          }).then((started) => {
            if ((started as { error?: string }).error) {
              const msg = (started as { error: string }).error;
              markQueueRunFinal(claim.run_id, "failed", msg);
              void pumpQueuedRuns("queue-start-error");
            }
          }).catch((err) => {
            markQueueRunFinal(claim.run_id, "failed", err instanceof Error ? err.message : String(err));
            void pumpQueuedRuns("queue-start-crash");
          });
        }
      } while (queuePumpRequested);
    } finally {
      queuePumpActive = false;
    }
  }

  function reconcileOrphanedRun(runId: string): boolean {
    if (activeRuns.has(runId)) return false;
    const row = db.prepare("SELECT id, status, run_json, updated_at FROM dag_runs WHERE id = ?").get(runId) as Record<string, unknown> | undefined;
    if (!row) return false;
    const status = String(row.status ?? "");
    if (!["running", "paused_approval", "pending"].includes(status)) return false;

    const queueRow = selectQueueByRun.get(runId) as Record<string, unknown> | undefined;
    const queueStatus = String(queueRow?.status ?? "");
    if (["pending", "claimed", "running"].includes(queueStatus)) return false;

    const updatedAt = new Date(String(row.updated_at ?? 0)).getTime();
    if (!updatedAt || (Date.now() - updatedAt) < safety.orphanTimeoutMs) return false;

    const run = JSON.parse(String(row.run_json ?? "{}"));
    run.status = "failed";
    if (run.blocks && typeof run.blocks === "object") {
      for (const block of Object.values(run.blocks as Record<string, Record<string, unknown>>)) {
        if (block.status === "running") block.status = "failed";
      }
    }

    const now = new Date().toISOString();
    db.prepare("UPDATE dag_runs SET status = ?, run_json = ?, updated_at = ? WHERE id = ?").run(
      "failed",
      JSON.stringify(run),
      now,
      runId
    );
    try {
      insertDagEvent.run(
        `dgev_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
        runId,
        "run:fail",
        null,
        JSON.stringify({ status: "failed", error_code: "ORPHANED_RUN", reason: "No active execution heartbeat" }),
        now
      );
    } catch {
      // best effort
    }
    return true;
  }

  function clearRunGuards(runId: string) {
    const t1 = runSafetyTimers.get(runId); if (t1) clearTimeout(t1);
    runSafetyTimers.delete(runId);
    const t2 = runStallTimers.get(runId); if (t2) clearTimeout(t2);
    runStallTimers.delete(runId);
    const waiters = approvalWaiters.get(runId);
    if (waiters) {
      for (const resolve of waiters) resolve();
      approvalWaiters.delete(runId);
    }
    runStallCounts.delete(runId);
  }

  function waitForApprovalSignal(runId: string): Promise<void> {
    return new Promise((resolve) => {
      const set = approvalWaiters.get(runId) ?? new Set<() => void>();
      set.add(resolve);
      approvalWaiters.set(runId, set);
    });
  }

  function signalApproval(runId: string): void {
    const set = approvalWaiters.get(runId);
    if (!set) return;
    for (const resolve of set) resolve();
    approvalWaiters.delete(runId);
  }

  function armStallTimer(runId: string) {
    const prev = runStallTimers.get(runId);
    if (prev) clearTimeout(prev);

    const t = setTimeout(() => {
      const live = activeRuns.get(runId);
      if (!live) return;
      if (live.run.status === "completed" || live.run.status === "failed" || live.run.status === "cancelled") return;

      const hasRunningBlock = Object.values(live.run.blocks).some((b) => b.status === "running");
      if (hasRunningBlock) {
        const attempts = (runStallCounts.get(runId) ?? 0) + 1;
        runStallCounts.set(runId, attempts);
        if (attempts <= 3) {
          console.warn(`[dag-api] stall grace for run ${runId}: running block still active (attempt ${attempts}/3)`);
          armStallTimer(runId);
          return;
        }
      }

      live.run.status = "cancelled";
      for (const block of Object.values(live.run.blocks)) {
        if (block.status === "running" || block.status === "pending" || block.status === "ready" || block.status === "retrying") {
          block.status = "skipped";
        }
      }

      const ctl = runAbortControllers.get(runId);
      if (ctl && !ctl.signal.aborted) {
        console.warn(`[dag-api] aborting run ${runId}: stall_detected`);
        ctl.abort("stall_detected");
      }
      runAbortControllers.delete(runId);
      clearRunGuards(runId);
      persistRunSnapshot(live);
      markQueueRunFinal(runId, "cancelled", "stall_timeout_exceeded");
      broadcast(runId, {
        type: "run:fail",
        run_id: runId,
        data: { status: "cancelled", reason: "stall_timeout_exceeded" },
        timestamp: new Date().toISOString(),
      });
      void pumpQueuedRuns("stall-timeout");
    }, safety.stallTimeoutMs);

    runStallTimers.set(runId, t);
  }

  // Broadcast event to all SSE clients for a run
  function broadcast(runId: string, event: DAGEvent) {
    const events = runEvents.get(runId) ?? [];
    events.push(event);
    runEvents.set(runId, events);

    // Durable event write (best-effort)
    try {
      const info = insertDagEvent.run(
        `dgev_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
        runId,
        event.type,
        event.block_id ?? null,
        JSON.stringify(event.data ?? {}),
        event.timestamp
      );
      event.seq = Number(info.lastInsertRowid);
    } catch (err) {
      console.error("[dag-api] failed to persist dag event:", err instanceof Error ? err.message : err);
    }

    const clients = sseClients.get(runId);
    if (clients) {
      for (const cb of clients) cb(event);
    }

    if (["run:start", "block:start", "block:complete", "block:fail", "approval:requested", "approval:decided"].includes(event.type)) {
      if (["block:start", "block:complete", "block:fail", "approval:decided"].includes(event.type)) {
        runStallCounts.set(runId, 0);
      }
      armStallTimer(runId);
    }
  }

  const maxRequestBytes = Number(process.env.OPENSKELO_MAX_REQUEST_BYTES ?? String(512 * 1024));
  const rateLimitWindowMs = Number(process.env.OPENSKELO_RATE_LIMIT_WINDOW_MS ?? "60000");
  const rateLimitMax = Number(process.env.OPENSKELO_RATE_LIMIT_MAX ?? "120");
  const configuredApiKey = String(process.env.OPENSKELO_API_KEY ?? "").trim();
  const rateBuckets = new Map<string, { count: number; resetAt: number }>();

  app.use("/api/dag/*", async (c, next) => {
    if (configuredApiKey) {
      const auth = String(c.req.header("authorization") ?? "");
      const bearer = auth.toLowerCase().startsWith("bearer ") ? auth.slice(7).trim() : "";
      const xApiKey = String(c.req.header("x-api-key") ?? "").trim();
      const presented = bearer || xApiKey;
      if (presented !== configuredApiKey) {
        return jsonError(c, 401, "Unauthorized", "UNAUTHORIZED");
      }
    }
    const lenHeader = c.req.header("content-length");
    if (lenHeader) {
      const n = Number(lenHeader);
      if (Number.isFinite(n) && n > maxRequestBytes) {
        return jsonError(c, 413, `Request too large. Max ${maxRequestBytes} bytes`, "REQUEST_TOO_LARGE", { maxRequestBytes });
      }
    }

    const clientKey = String(c.req.header("x-forwarded-for") ?? c.req.header("x-real-ip") ?? "local");
    const now = Date.now();
    const existing = rateBuckets.get(clientKey);
    if (!existing || existing.resetAt <= now) {
      rateBuckets.set(clientKey, { count: 1, resetAt: now + rateLimitWindowMs });
    } else {
      existing.count += 1;
      if (existing.count > rateLimitMax) {
        return jsonError(c, 429, "Rate limit exceeded", "RATE_LIMITED", { retryAfterMs: Math.max(0, existing.resetAt - now) });
      }
    }

    await next();
  });

  app.get("/api/dag/safety", (c) => c.json({ safety, limits: { maxRequestBytes, rateLimitWindowMs, rateLimitMax }, auth: { apiKeyRequired: Boolean(configuredApiKey) } }));

  // Startup orphan sweep (durable runs marked running with no active execution)
  try {
    const candidates = db.prepare("SELECT id FROM dag_runs WHERE status IN ('running','paused_approval','pending')").all() as Array<Record<string, unknown>>;
    for (const c of candidates) reconcileOrphanedRun(String(c.id));
  } catch {
    // best effort
  }
  void pumpQueuedRuns("startup");

  // List available example DAGs
  app.get("/api/dag/examples", (c) => {
    const examples: { name: string; file: string }[] = [];

    let files: string[] = [];
    try {
      files = readdirSync(examplesBaseDir).filter((f) => f.endsWith(".yaml") || f.endsWith(".yml"));
    } catch {
      files = [];
    }

    for (const file of files) {
      const path = resolve(examplesBaseDir, file);
      if (!existsSync(path)) continue;
      try {
        const raw = parseYamlWithDiagnostics(readFileSync(path, "utf-8"), path) as Record<string, unknown>;
        examples.push({ name: (raw.name as string | undefined) ?? file, file });
      } catch {
        // skip malformed files
      }
    }

    examples.sort((a, b) => a.name.localeCompare(b.name));
    return c.json({ examples });
  });

  // Get a DAG definition (parsed)
  app.get("/api/dag/examples/:file", (c) => {
    const file = c.req.param("file");
    const path = resolve(examplesBaseDir, file);
    if (!existsSync(path)) return jsonError(c, 404, "Not found", "NOT_FOUND");

    try {
      const raw = parseYamlWithDiagnostics<Record<string, unknown>>(readFileSync(path, "utf-8"), path);
      const dag = engine.parseDAG(raw);
      return c.json({ dag, order: engine.executionOrder(dag) });
    } catch (err) {
      return jsonError(c, 400, toSkeloError(err, "BAD_REQUEST", 400));
    }
  });

  async function startDagExecution(
    dag: DAGDef,
    context: Record<string, unknown>,
    body: Record<string, unknown>,
    opts?: {
      skipConcurrencyGate?: boolean;
      queuedRunId?: string;
    }
  ) {
    // Enforce DAG safety caps
    dag.blocks = dag.blocks.map((b) => ({
      ...b,
      retry: {
        ...b.retry,
        max_attempts: Math.min(Number(b.retry?.max_attempts ?? 0), safety.maxRetriesCap),
      },
      timeout_ms: Math.min(Number(b.timeout_ms ?? safety.maxBlockDurationMs), safety.maxBlockDurationMs),
    }));

    // Build agents map from config
    const agents: Record<string, { role: string; capabilities: string[]; provider: string; model: string }> = {};
    for (const [id, agent] of Object.entries(config.agents)) {
      agents[id] = {
        role: agent.role,
        capabilities: agent.capabilities,
        provider: agent.provider,
        model: agent.model,
      };
    }

    const providerMode = (body.provider as string | undefined)?.trim();

    const pipelineAgentKey = Object.keys(config.agents).find((k) => k === "pipeline")
      ?? Object.entries(config.agents).find(([, a]) => String(a.role) === "pipeline")?.[0]
      ?? null;

    const roleDerivedMapping = Object.entries(config.agents).reduce((acc, [id, a]) => {
      // keep first role match stable; avoid silent overwrite when multiple agents share a role
      if (!acc[a.role]) {
        const managerTarget = pipelineAgentKey ?? id;
        acc[a.role] = a.role === "manager" ? managerTarget : id;
      }
      // preserve explicit id passthrough mapping
      acc[id] = id;
      return acc;
    }, {} as Record<string, string>);

    const userMapping = (body.agentMapping as Record<string, string> | undefined) ?? {};
    const unknownTargets = Object.values(userMapping).filter((v) => !config.agents[v]);
    if (unknownTargets.length > 0) {
      return {
        error: `Invalid agentMapping target(s): ${unknownTargets.join(", ")}. Known agents: ${Object.keys(config.agents).join(", ")}`,
        status: 400 as const,
      };
    }

    const openclawProvider = createOpenClawProvider({
      agentMapping: {
        ...roleDerivedMapping,
        ...userMapping,
      },
      timeoutSeconds: Math.min((body.timeoutSeconds as number) ?? 300, Math.ceil(safety.maxBlockDurationMs / 1000)),
      model: (body.model as string | undefined) ?? "openai-codex/gpt-5.3-codex",
      thinking: body.thinking as string | undefined,
    });

    const mockProvider = createMockProvider({
      minDelay: 200,
      maxDelay: 900,
      failureRate: 0,
    });

    const providers: Record<string, ProviderAdapter> = {};
    for (const p of config.providers) {
      if (p.type === "openclaw") {
        providers[p.name] = openclawProvider;
        continue;
      }
      if (p.type === "ollama") {
        providers[p.name] = createOllamaProvider({
          name: p.name,
          baseUrl: p.url,
          timeoutMs: Math.min(Number(body.timeoutSeconds ?? 120) * 1000, safety.maxBlockDurationMs),
        });
        continue;
      }
      if (p.type === "openai" || p.type === "anthropic" || p.type === "http" || p.type === "openrouter" || p.type === "minimax") {
        const authHeader = typeof p.config?.authHeader === "string" ? p.config.authHeader : undefined;
        const baseUrl = p.type === "openrouter"
          ? (p.url ?? "https://openrouter.ai/api/v1")
          : p.type === "minimax"
            ? (p.url ?? "https://api.minimax.io/v1")
            : p.url;
        const apiKeyEnv = p.type === "openrouter"
          ? (p.env ?? "OPENROUTER_API_KEY")
          : p.type === "minimax"
            ? (p.env ?? "MINIMAX_API_KEY")
            : p.env;
        const authToken = getProviderToken(p.name) ?? getProviderToken(p.type);
        providers[p.name] = createOpenAICompatibleProvider({
          name: p.name,
          baseUrl,
          apiKey: authToken ?? undefined,
          apiKeyEnv,
          authHeader,
          timeoutMs: Math.min(Number(body.timeoutSeconds ?? 120) * 1000, safety.maxBlockDurationMs),
        });
        continue;
      }
      // Unknown provider type fallback
      providers[p.name] = mockProvider;
    }

    // Optional provider override by name or type: route all agent providers to selected adapter
    let providerWarning: string | undefined;
    let effectiveProviderMode = providerMode;
    if (providerMode) {
      const byName = config.providers.find((p) => p.name === providerMode);
      const byType = config.providers.find((p) => p.type === providerMode);
      let selected = byName ?? byType;

      if (!selected) {
        const fallback = config.providers.find((p) => p.name === "local");
        if (!fallback) {
          return {
            error: `Unknown provider '${providerMode}'. Available: ${config.providers.map((p) => p.name).join(", ")}`,
            status: 400 as const,
          };
        }
        selected = fallback;
        effectiveProviderMode = selected.name;
        providerWarning = `Unknown provider '${providerMode}' requested. Falling back to '${selected.name}'.`;
      }

      const selectedAdapter = providers[selected.name];
      for (const key of Object.keys(providers)) providers[key] = selectedAdapter;
    }

    const runAbortController = new AbortController();
    let runIdRef = "";

    const executor = createDAGExecutor({
      providers,
      agents,
      maxParallel: 4,
      budget: {
        maxTokensPerRun: Number(process.env.OPENSKELO_MAX_TOKENS_PER_RUN ?? "0"),
        maxTokensPerBlock: Number(process.env.OPENSKELO_MAX_TOKENS_PER_BLOCK ?? "0"),
      },
      projectRoot: process.cwd(),
      abortSignal: runAbortController.signal,
      isCancelled: () => (runIdRef ? activeRuns.get(runIdRef)?.run.status === "cancelled" : false),
      waitForApproval: async (run) => {
        if (run.status !== "paused_approval") return;
        await waitForApprovalSignal(run.id);
      },
      onBlockStart: (run, blockId) => {
        const entry = activeRuns.get(run.id);
        if (entry) persistRunSnapshot(entry);
        broadcast(run.id, {
          type: "block:start",
          run_id: run.id,
          block_id: blockId,
          data: { instance: run.blocks[blockId] },
          timestamp: new Date().toISOString(),
        });
      },
      onBlockComplete: (run, blockId) => {
        const entry = activeRuns.get(run.id);
        if (entry) persistRunSnapshot(entry);
        broadcast(run.id, {
          type: "block:complete",
          run_id: run.id,
          block_id: blockId,
          data: { instance: run.blocks[blockId] },
          timestamp: new Date().toISOString(),
        });
      },
      onBlockFail: (run, blockId, error, errorCode, info) => {
        const entry = activeRuns.get(run.id);
        if (entry) persistRunSnapshot(entry);
        broadcast(run.id, {
          type: "block:fail",
          run_id: run.id,
          block_id: blockId,
          data: {
            error,
            error_code: errorCode ?? "UNKNOWN",
            error_stage: info?.stage ?? "unknown",
            error_message: info?.message ?? error,
            repair: info?.repair ?? null,
            contract_trace: info?.contract_trace ?? null,
            raw_output_preview: info?.raw_output_preview ?? null,
            provider_exit_code: info?.provider_exit_code ?? null,
            attempt: run.blocks[blockId]?.retry_state?.attempt ?? null,
            max_attempts: run.blocks[blockId]?.retry_state?.max_attempts ?? null,
            failed_at: new Date().toISOString(),
            instance: run.blocks[blockId],
          },
          timestamp: new Date().toISOString(),
        });
      },
      onRunComplete: (run) => {
        const entry = activeRuns.get(run.id);
        if (entry) persistRunSnapshot(entry);
        runAbortControllers.delete(run.id);
        clearRunGuards(run.id);
        markQueueRunFinal(run.id, "completed");
        broadcast(run.id, {
          type: "run:complete",
          run_id: run.id,
          data: { status: run.status },
          timestamp: new Date().toISOString(),
        });
        void pumpQueuedRuns("run-complete");
      },
      onRunFail: (run) => {
        const entry = activeRuns.get(run.id);
        if (entry) persistRunSnapshot(entry);
        runAbortControllers.delete(run.id);
        clearRunGuards(run.id);
        markQueueRunFinal(run.id, run.status === "cancelled" ? "cancelled" : "failed");
        broadcast(run.id, {
          type: "run:fail",
          run_id: run.id,
          data: { status: run.status },
          timestamp: new Date().toISOString(),
        });
        void pumpQueuedRuns("run-fail");
      },
      onApprovalRequired: (run, blockId, approval) => {
        const entry = activeRuns.get(run.id);
        if (entry) persistRunSnapshot(entry);
        try {
          const ap = approval as Record<string, unknown>;
          upsertDagApproval.run(
            String(ap.token ?? `apr_${run.id}_${blockId}`),
            run.id,
            blockId,
            String(ap.status ?? "pending"),
            String(ap.prompt ?? "Approval required"),
            String(ap.approver ?? "owner"),
            String(ap.requested_at ?? new Date().toISOString()),
            null,
            null,
            JSON.stringify(ap)
          );
        } catch (err) {
          console.error("[dag-api] failed to persist approval request:", err instanceof Error ? err.message : err);
        }

        broadcast(run.id, {
          type: "approval:requested",
          run_id: run.id,
          block_id: blockId,
          data: approval,
          timestamp: new Date().toISOString(),
        });
        notifyApprovalViaTelegram(run, approval as Record<string, unknown>);
      },
    });

    const activeRunningCount = getActiveRunningCount();
    if (!opts?.skipConcurrencyGate && activeRunningCount >= safety.maxConcurrentRuns) {
      return {
        error: "Concurrency limit reached",
        limit: safety.maxConcurrentRuns,
        active: activeRunningCount,
        status: 429 as const,
      };
    }

    // Create or load initial run state for immediate response
    let initialRun: DAGRun;
    if (opts?.queuedRunId) {
      const row = db.prepare("SELECT run_json FROM dag_runs WHERE id = ?").get(opts.queuedRunId) as Record<string, unknown> | undefined;
      if (row?.run_json) {
        initialRun = JSON.parse(String(row.run_json)) as DAGRun;
      } else {
        initialRun = engine.createRun(dag, context);
        initialRun.id = opts.queuedRunId;
      }
    } else {
      initialRun = engine.createRun(dag, context);
    }

    runIdRef = initialRun.id;
    runAbortControllers.set(initialRun.id, runAbortController);
    activeRuns.set(initialRun.id, { dag, run: initialRun });
    runEvents.set(initialRun.id, runEvents.get(initialRun.id) ?? []);
    {
      const entry = activeRuns.get(initialRun.id);
      if (entry) persistRunSnapshot(entry);
    }

    if (opts?.queuedRunId) {
      const now = new Date().toISOString();
      markQueueRunning.run("dag-api:launcher", null, null, now, now, initialRun.id);
    }

    broadcast(initialRun.id, {
      type: "run:start",
      run_id: initialRun.id,
      data: { dag_name: dag.name, blocks: dag.blocks.map(b => b.id), safety },
      timestamp: new Date().toISOString(),
    });

    const safetyTimer = setTimeout(() => {
      const live = activeRuns.get(initialRun.id);
      if (!live) return;
      if (live.run.status === "completed" || live.run.status === "failed" || live.run.status === "cancelled") return;
      live.run.status = "cancelled";
      for (const block of Object.values(live.run.blocks)) {
        if (block.status === "running" || block.status === "pending" || block.status === "ready" || block.status === "retrying") {
          block.status = "skipped";
        }
      }
      const ctl = runAbortControllers.get(initialRun.id);
      if (ctl && !ctl.signal.aborted) {
        console.warn(`[dag-api] aborting run ${initialRun.id}: run exceeded max duration`);
        ctl.abort("run exceeded max duration");
      }
      runAbortControllers.delete(initialRun.id);
      clearRunGuards(initialRun.id);
      persistRunSnapshot(live);
      markQueueRunFinal(initialRun.id, "cancelled", "max_run_duration_exceeded");
      broadcast(initialRun.id, {
        type: "run:fail",
        run_id: initialRun.id,
        data: { status: "cancelled", reason: "max_run_duration_exceeded" },
        timestamp: new Date().toISOString(),
      });
      void pumpQueuedRuns("max-duration-timeout");
    }, safety.maxRunDurationMs);
    runSafetyTimers.set(initialRun.id, safetyTimer);

    // Execute asynchronously — pass the stored run reference so mutations are visible
    executor.execute(dag, context, initialRun).then((result) => {
      const entry = activeRuns.get(initialRun.id);
      if (entry) {
        entry.result = result;
        persistRunSnapshot(entry);
      }
      if (initialRun.status === "cancelled") {
        runAbortControllers.delete(initialRun.id);
      }
      clearRunGuards(initialRun.id);
    }).catch((err) => {
      runAbortControllers.delete(initialRun.id);
      clearRunGuards(initialRun.id);
      markQueueRunFinal(initialRun.id, "failed", err instanceof Error ? err.message : String(err));
      void pumpQueuedRuns("run-crash");
      console.error("[dag-api] Run failed:", err);
    });

    return {
      run_id: initialRun.id,
      dag_name: dag.name,
      blocks: dag.blocks.map(b => ({ id: b.id, name: b.name })),
      edges: dag.edges,
      sse_url: `/api/dag/runs/${initialRun.id}/events`,
      provider_mode: effectiveProviderMode,
      warning: providerWarning,
      queued: false,
    };
  }

  async function enqueueDagExecution(dag: DAGDef, context: Record<string, unknown>, body: Record<string, unknown>) {
    const now = new Date().toISOString();
    const run = engine.createRun(dag, context);

    upsertDagRun.run(
      run.id,
      dag.name,
      run.status,
      JSON.stringify(dag),
      JSON.stringify(run),
      JSON.stringify([]),
      run.created_at,
      now
    );

    const priority = normalizePriority(body.priority);
    const manualRank = parseManualRank(body.manual_rank ?? body.manualRank);
    const payload = {
      dag,
      context,
      body,
    };

    upsertQueueEntry.run(
      run.id,
      "pending",
      priority,
      manualRank,
      null,
      null,
      null,
      0,
      JSON.stringify(payload),
      null,
      now,
      now,
      null,
      null
    );

    void pumpQueuedRuns("enqueue");

    const queued = selectQueueByRun.get(run.id) as Record<string, unknown> | undefined;

    return {
      run_id: run.id,
      dag_name: dag.name,
      blocks: dag.blocks.map((b) => ({ id: b.id, name: b.name })),
      edges: dag.edges,
      sse_url: `/api/dag/runs/${run.id}/events`,
      provider_mode: (body.provider as string | undefined) ?? undefined,
      warning: undefined,
      queued: true,
      queue: queued
        ? {
            status: String(queued.status ?? "pending"),
            priority: Number(queued.priority ?? 0),
            manual_rank: queued.manual_rank === null || queued.manual_rank === undefined ? null : Number(queued.manual_rank),
          }
        : { status: "pending", priority, manual_rank: manualRank },
    };
  }

  // Start a DAG run
  app.post("/api/dag/run", async (c) => {
    const body = await c.req.json();
    const file = body.example as string | undefined;
    const context = (body.context as Record<string, unknown>) ?? {};
    const devMode = body.devMode === true || process.env.OPENSKELO_DEV_MODE === "1";
    if (devMode) context.__dev_auto_approve = true;

    const originalIntent = String((context.prompt ?? context.topic ?? context.request ?? "") as string);
    if (!context.__shared_memory || typeof context.__shared_memory !== "object") {
      context.__shared_memory = { original_intent: originalIntent, feedback_history: [], decisions: [] };
    }
    context.__run_options = {
      provider: (body.provider as string) ?? "openclaw",
      agentMapping: body.agentMapping,
      timeoutSeconds: body.timeoutSeconds,
      model: body.model,
      thinking: body.thinking,
    };

    let dag: DAGDef;
    try {
      if (file) {
        const path = resolve(examplesBaseDir, file);
        if (!existsSync(path)) return jsonError(c, 404, "Example not found", "EXAMPLE_NOT_FOUND");
        const raw = parseYamlWithDiagnostics<Record<string, unknown>>(readFileSync(path, "utf-8"), path);
        dag = engine.parseDAG(raw);
      } else if (body.dag) {
        dag = engine.parseDAG(body.dag);
      } else {
        return jsonError(c, 400, "Provide 'example' filename or 'dag' definition", "INVALID_INPUT");
      }
    } catch (err) {
      return jsonError(c, 400, toSkeloError(err, "BAD_REQUEST", 400));
    }

    const activeRunningCount = getActiveRunningCount();
    const shouldQueue = activeRunningCount >= safety.maxConcurrentRuns;

    const started = shouldQueue
      ? await enqueueDagExecution(dag, context, body as Record<string, unknown>)
      : await startDagExecution(dag, context, body as Record<string, unknown>);

    if ((started as { error?: string }).error) {
      const status = (started as { status?: number }).status ?? 400;
      return jsonError(c, status, (started as { error: string }).error, "START_FAILED");
    }

    const httpStatus = (started as { queued?: boolean }).queued ? 202 : 201;
    return c.json(started, httpStatus);
  });

  function reconstructRunFromEvents(baseRun: Record<string, unknown>, durableEvents: Array<Record<string, unknown>>): Record<string, unknown> {
    const run = JSON.parse(JSON.stringify(baseRun ?? {})) as Record<string, unknown>;
    const blocks = (run.blocks as Record<string, Record<string, unknown>> | undefined) ?? {};

    for (const e of durableEvents) {
      const type = String(e.event_type ?? "");
      const data = JSON.parse(String(e.data_json ?? "{}")) as Record<string, unknown>;
      const blockId = e.block_id ? String(e.block_id) : undefined;

      if (blockId && data.instance && typeof data.instance === "object") {
        blocks[blockId] = data.instance as Record<string, unknown>;
      }

      if (type === "run:complete") run.status = "completed";
      else if (type === "run:fail") run.status = "failed";
      else if (type === "run:iterated") run.status = "iterated";
      else if (type === "approval:requested" && run.status !== "completed" && run.status !== "failed" && run.status !== "iterated") run.status = "paused_approval";
      else if (type === "approval:decided" && run.status === "paused_approval") run.status = "running";
    }

    run.blocks = blocks;
    return run;
  }

  // Get run status
  app.get("/api/dag/runs/:id", (c) => {
    const runId = c.req.param("id");
    const entry = activeRuns.get(runId);
    if (entry) {
      return c.json({
        run: entry.run,
        dag: entry.dag,
        approval: entry.run.context.__approval_request ?? null,
        events: runEvents.get(entry.run.id) ?? [],
        trace: entry.result?.trace ?? [],
      });
    }

    // Fallback to durable store (Phase A)
    reconcileOrphanedRun(runId);
    const row = db.prepare("SELECT * FROM dag_runs WHERE id = ?").get(runId) as Record<string, unknown> | undefined;
    if (!row) return jsonError(c, 404, "Not found", "NOT_FOUND");
    const events = db.prepare("SELECT rowid as seq, event_type, run_id, block_id, data_json, timestamp FROM dag_events WHERE run_id = ? ORDER BY rowid ASC").all(runId) as Array<Record<string, unknown>>;
    const approval = db.prepare("SELECT * FROM dag_approvals WHERE run_id = ? AND status = 'pending' ORDER BY requested_at DESC LIMIT 1").get(runId) as Record<string, unknown> | undefined;

    const baseRun = JSON.parse(String(row.run_json ?? "{}")) as Record<string, unknown>;
    const run = reconstructRunFromEvents(baseRun, events);
    const dag = JSON.parse(String(row.dag_json ?? "{}"));
    const trace = JSON.parse(String(row.trace_json ?? "[]"));

    return c.json({
      run,
      dag,
      approval: approval ? JSON.parse(String(approval.payload_json ?? "{}")) : null,
      events: events.map((e) => ({
        type: e.event_type,
        run_id: e.run_id,
        block_id: e.block_id ?? undefined,
        data: JSON.parse(String(e.data_json ?? "{}")),
        timestamp: e.timestamp,
        seq: Number(e.seq ?? 0),
      })),
      trace,
      durable: true,
      reconstructed: true,
    });
  });

  async function resolveApproval(runId: string, token: string | null, body: Record<string, unknown>) {
    const entry = activeRuns.get(runId);
    if (!entry) return { status: 404 as const, payload: { error: "Not found", code: "NOT_FOUND" } };

    const request = entry.run.context.__approval_request as Record<string, unknown> | undefined;
    if (!request || request.status !== "pending") {
      return { status: 400 as const, payload: { error: "No pending approval", code: "NO_PENDING_APPROVAL" } };
    }

    // token optional for UX: allow tokenless approvals when runId matches and request is pending
    if (token && token !== "latest" && request.token !== token) {
      return { status: 403 as const, payload: { error: "Invalid approval token", code: "INVALID_APPROVAL_TOKEN" } };
    }

    const decision = (body.decision as string) ?? "reject";
    const notes = (body.notes as string) ?? "";
    const feedback = (body.feedback as string) ?? notes;
    const restartMode = (body.restart_mode as string) ?? "refine"; // refine | from_scratch

    request.status = decision;
    request.decided_at = new Date().toISOString();
    request.notes = notes;
    request.feedback = feedback;
    request.restart_mode = restartMode;

    try {
      upsertDagApproval.run(
        String(request.token ?? token ?? `apr_${entry.run.id}_${String(request.block_id ?? "unknown")}`),
        entry.run.id,
        String(request.block_id ?? "unknown"),
        String(request.status ?? decision),
        String(request.prompt ?? "Approval required"),
        String(request.approver ?? "owner"),
        String(request.requested_at ?? entry.run.created_at),
        String(request.decided_at ?? new Date().toISOString()),
        notes,
        JSON.stringify(request)
      );
    } catch (err) {
      console.error("[dag-api] failed to persist approval decision:", err instanceof Error ? err.message : err);
    }

    const blockId = String(request.block_id);

    // Shared memory update (phase 1 persistence)
    const shared = (entry.run.context.__shared_memory as Record<string, unknown> | undefined) ?? {};
    const decisions = Array.isArray(shared.decisions) ? (shared.decisions as Array<Record<string, unknown>>) : [];
    decisions.push({
      at: new Date().toISOString(),
      run_id: entry.run.id,
      block_id: blockId,
      decision,
      feedback,
      restart_mode: restartMode,
    });
    shared.decisions = decisions;

    if (decision === "reject" && feedback) {
      const history = Array.isArray(shared.feedback_history) ? (shared.feedback_history as string[]) : [];
      history.push(feedback);
      shared.feedback_history = history;
      entry.run.context.__latest_feedback = feedback;
    }
    entry.run.context.__shared_memory = shared;

    if (decision === "approve") {
      entry.run.context[`__approval_${blockId}`] = true;
      // Bridge approval decision into block input when needed (e.g., release gate on `approved`)
      entry.run.context[`__override_input_${blockId}_approved`] = true;
      entry.run.status = "running";
      persistRunSnapshot(entry);
      signalApproval(entry.run.id);

      broadcast(entry.run.id, {
        type: "approval:decided",
        run_id: entry.run.id,
        block_id: blockId,
        data: { decision, notes, feedback, restart_mode: restartMode, input_overrides: { approved: true } },
        timestamp: new Date().toISOString(),
      });

      return { status: 200 as const, payload: { ok: true, decision, feedback, restart_mode: restartMode, run_status: entry.run.status } };
    }

    // Reject path: optionally spawn next cycle (phase 2)
    const shouldIterate = body.iterate !== false;

    broadcast(entry.run.id, {
      type: "approval:decided",
      run_id: entry.run.id,
      block_id: blockId,
      data: { decision, notes, feedback, restart_mode: restartMode, iterate: shouldIterate },
      timestamp: new Date().toISOString(),
    });

    if (!shouldIterate) {
      entry.run.status = "failed";
      persistRunSnapshot(entry);
      signalApproval(entry.run.id);
      return { status: 200 as const, payload: { ok: true, decision, feedback, restart_mode: restartMode, run_status: entry.run.status } };
    }

    const nextContext = { ...(entry.run.context as Record<string, unknown>) };
    const shared2 = (nextContext.__shared_memory as Record<string, unknown> | undefined) ?? {};
    const cycle = Number(shared2.cycle ?? 0) + 1;
    const maxCycles = Number(shared2.max_cycles ?? 5);
    shared2.cycle = cycle;
    shared2.max_cycles = maxCycles;
    nextContext.__shared_memory = shared2;
    nextContext.__iteration_parent_run_id = entry.run.id;
    nextContext.__iteration_root_run_id = String(nextContext.__iteration_root_run_id ?? entry.run.id);

    if (cycle > maxCycles) {
      entry.run.status = "failed";
      persistRunSnapshot(entry);
      signalApproval(entry.run.id);
      return { status: 200 as const, payload: { ok: true, decision, feedback, restart_mode: restartMode, run_status: entry.run.status, iteration_stopped: "max_cycles_reached" } };
    }

    if (restartMode === "from_scratch") {
      const original = String((shared2.original_intent ?? nextContext.prompt ?? "") as string);
      nextContext.prompt = original;
    }
    nextContext.__latest_feedback = feedback;

    const runOpts = (nextContext.__run_options as Record<string, unknown> | undefined) ?? {};
    const started = await startDagExecution(entry.dag, nextContext, runOpts);
    if ((started as { error?: string }).error) {
      entry.run.status = "failed";
      persistRunSnapshot(entry);
      signalApproval(entry.run.id);
      return { status: 200 as const, payload: { ok: true, decision, feedback, restart_mode: restartMode, run_status: entry.run.status, iteration_error: (started as { error: string }).error } };
    }

    const childRunId = (started as { run_id: string }).run_id;
    entry.run.status = "iterated";
    entry.run.context.__latest_iterated_run_id = childRunId;
    persistRunSnapshot(entry);
    signalApproval(entry.run.id);

    broadcast(entry.run.id, {
      type: "run:iterated",
      run_id: entry.run.id,
      block_id: blockId,
      data: { iterated_run_id: childRunId, restart_mode: restartMode, feedback },
      timestamp: new Date().toISOString(),
    });

    return {
      status: 200 as const,
      payload: {
        ok: true,
        decision,
        feedback,
        restart_mode: restartMode,
        run_status: entry.run.status,
        iterated_run_id: childRunId,
      },
    };
  }

  // Approve/reject pending human approval gate (tokened)
  app.post("/api/dag/runs/:id/approvals/:token", async (c) => {
    const body = await c.req.json().catch(() => ({}));
    const result = await resolveApproval(c.req.param("id"), c.req.param("token"), body as Record<string, unknown>);
    return c.json(result.payload, result.status);
  });

  // Approve/reject pending human approval gate (tokenless UX path)
  app.post("/api/dag/runs/:id/approvals", async (c) => {
    const body = await c.req.json().catch(() => ({}));
    const result = await resolveApproval(c.req.param("id"), null, body as Record<string, unknown>);
    return c.json(result.payload, result.status);
  });

  // Durable replay endpoint (checkpoint 2)
  app.get("/api/dag/runs/:id/replay", (c) => {
    const runId = c.req.param("id");
    const since = Number(c.req.query("since") ?? "0") || 0;

    const row = db.prepare("SELECT id, status, updated_at FROM dag_runs WHERE id = ?").get(runId) as Record<string, unknown> | undefined;
    if (!row) return jsonError(c, 404, "Not found", "NOT_FOUND");

    const events = selectDagEventsSince.all(runId, since) as Array<Record<string, unknown>>;
    return c.json({
      run_id: runId,
      status: row.status,
      updated_at: row.updated_at,
      since,
      events: events.map((e) => ({
        type: String(e.event_type),
        run_id: String(e.run_id),
        block_id: e.block_id ? String(e.block_id) : undefined,
        data: JSON.parse(String(e.data_json ?? "{}")),
        timestamp: String(e.timestamp),
        seq: Number(e.seq ?? 0),
      })),
      next_since: events.length ? Number(events[events.length - 1].seq ?? since) : since,
    });
  });

  // SSE stream for real-time events (supports replay via Last-Event-ID)
  app.get("/api/dag/runs/:id/events", (c) => {
    const runId = c.req.param("id");

    const hasActive = activeRuns.has(runId);
    const existsDurable = db.prepare("SELECT 1 FROM dag_runs WHERE id = ? LIMIT 1").get(runId);
    if (!hasActive && !existsDurable) return jsonError(c, 404, "Not found", "NOT_FOUND");

    const lastEventIdRaw = c.req.header("last-event-id") ?? c.req.query("since") ?? "0";
    const rawSince = Number(lastEventIdRaw);
    const sinceSeq = Number.isFinite(rawSince) && rawSince > 0 ? rawSince : 0;

    const requestedClientId = String(c.req.header("x-sse-client-id") ?? c.req.query("clientId") ?? "").trim();
    const clientId = requestedClientId || `sse_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
    c.header("x-sse-client-id", clientId);

    return streamSSE(c, async (stream) => {
      // Replay from durable store first (sequence-aware)
      const prior = selectDagEventsSince.all(runId, sinceSeq) as Array<Record<string, unknown>>;
      for (const e of prior) {
        const payload: DAGEvent = {
          type: String(e.event_type) as DAGEvent["type"],
          run_id: String(e.run_id),
          block_id: e.block_id ? String(e.block_id) : undefined,
          data: JSON.parse(String(e.data_json ?? "{}")),
          timestamp: String(e.timestamp),
          seq: Number(e.seq ?? 0),
        };
        await stream.writeSSE({
          id: String(payload.seq ?? ""),
          event: payload.type,
          data: JSON.stringify(payload),
        });
      }

      // If run is no longer active, replay-only mode (close)
      if (!activeRuns.has(runId)) return;

      // Register for new events with client-id dedupe
      const clients = sseClients.get(runId) ?? new Set();
      const registry = sseClientRegistry.get(runId) ?? new Map<string, (event: DAGEvent) => void>();

      const existing = registry.get(clientId);
      if (existing) clients.delete(existing);

      const handler = async (event: DAGEvent) => {
        try {
          await stream.writeSSE({
            id: String(event.seq ?? ""),
            event: event.type,
            data: JSON.stringify(event),
          });
        } catch {
          clients.delete(handler);
          registry.delete(clientId);
          if (clients.size === 0) sseClients.delete(runId);
          if (registry.size === 0) sseClientRegistry.delete(runId);
        }
      };

      clients.add(handler);
      registry.set(clientId, handler);
      sseClients.set(runId, clients);
      sseClientRegistry.set(runId, registry);

      // Keep alive until run completes or client disconnects
      const entry = activeRuns.get(runId);
      while (entry && entry.run.status !== "completed" && entry.run.status !== "failed" && entry.run.status !== "cancelled") {
        await new Promise(r => setTimeout(r, 500));
      }

      // Final keepalive then close
      await new Promise(r => setTimeout(r, 1000));
      clients.delete(handler);
      registry.delete(clientId);
      if (clients.size === 0) sseClients.delete(runId);
      if (registry.size === 0) sseClientRegistry.delete(runId);
    });
  });

  // Emergency stop all active runs
  app.post("/api/dag/runs/stop-all", (c) => {
    let stopped = 0;
    const now = new Date().toISOString();

    for (const [runId, entry] of activeRuns.entries()) {
      const status = entry.run.status;
      if (status === "completed" || status === "failed" || status === "cancelled") continue;

      entry.run.status = "cancelled";
      for (const block of Object.values(entry.run.blocks)) {
        if (block.status === "running" || block.status === "pending" || block.status === "ready" || block.status === "retrying") {
          block.status = "skipped";
        }
      }

      const ctl = runAbortControllers.get(runId);
      if (ctl && !ctl.signal.aborted) {
        console.warn(`[dag-api] aborting run ${runId}: emergency stop-all`);
        ctl.abort("emergency stop-all");
      }
      runAbortControllers.delete(runId);
      clearRunGuards(runId);

      persistRunSnapshot(entry);
      markQueueRunFinal(runId, "cancelled", "emergency_stop_all");
      broadcast(runId, {
        type: "run:fail",
        run_id: runId,
        data: { status: "cancelled", reason: "emergency_stop_all", stopped_at: now },
        timestamp: now,
      });
      stopped++;
    }

    const cancelledQueued = db.prepare("UPDATE dag_run_queue SET status = 'cancelled', last_error = ?, lease_expires_at = NULL, claim_owner = NULL, claim_token = NULL, finished_at = ?, updated_at = ? WHERE status IN ('pending','claimed')")
      .run("emergency_stop_all", now, now);

    if (Number(cancelledQueued.changes ?? 0) > 0) {
      const rows = db.prepare("SELECT id as run_id, run_json FROM dag_runs WHERE id IN (SELECT run_id FROM dag_run_queue WHERE status = 'cancelled' AND updated_at = ?)").all(now) as Array<Record<string, unknown>>;
      for (const row of rows) {
        const runId = String(row.run_id ?? "");
        const run = JSON.parse(String(row.run_json ?? "{}"));
        run.status = "cancelled";
        db.prepare("UPDATE dag_runs SET status = ?, run_json = ?, updated_at = ? WHERE id = ?").run("cancelled", JSON.stringify(run), now, runId);
      }
    }

    if (stopped > 0) void pumpQueuedRuns("stop-all");
    return c.json({ ok: true, stopped, cancelled_queued: Number(cancelledQueued.changes ?? 0) });
  });

  // Stop/cancel a run
  app.post("/api/dag/runs/:id/stop", (c) => {
    const runId = c.req.param("id");
    const entry = activeRuns.get(runId);

    if (entry) {
      entry.run.status = "cancelled";
      const ctl = runAbortControllers.get(runId);
      if (ctl && !ctl.signal.aborted) {
        console.warn(`[dag-api] aborting run ${runId}: run stopped by user`);
        ctl.abort("run stopped by user");
      }
      runAbortControllers.delete(runId);
      clearRunGuards(runId);
      for (const block of Object.values(entry.run.blocks)) {
        if (block.status === "running" || block.status === "pending" || block.status === "ready") {
          block.status = "skipped";
        }
      }

      persistRunSnapshot(entry);
      markQueueRunFinal(runId, "cancelled", "run stopped by user");

      broadcast(runId, {
        type: "run:fail",
        run_id: entry.run.id,
        data: { status: "cancelled" },
        timestamp: new Date().toISOString(),
      });

      void pumpQueuedRuns("stop-active-run");
      return c.json({ status: "cancelled", mode: "active" });
    }

    // Durable-only fallback: mark persisted run as cancelled even if not active in memory
    const row = db.prepare("SELECT id, run_json, trace_json, created_at, updated_at FROM dag_runs WHERE id = ?").get(runId) as Record<string, unknown> | undefined;
    if (!row) return jsonError(c, 404, "Not found", "NOT_FOUND");

    const run = JSON.parse(String(row.run_json ?? "{}"));
    run.status = "cancelled";
    if (run.blocks && typeof run.blocks === "object") {
      for (const block of Object.values(run.blocks as Record<string, Record<string, unknown>>)) {
        if (block.status === "running" || block.status === "pending" || block.status === "ready") {
          block.status = "skipped";
        }
      }
    }
    const now = new Date().toISOString();
    db.prepare("UPDATE dag_runs SET status = ?, run_json = ?, updated_at = ? WHERE id = ?").run(
      "cancelled",
      JSON.stringify(run),
      now,
      runId
    );
    markQueueRunFinal(runId, "cancelled", "durable stop");

    try {
      const info = insertDagEvent.run(
        `dgev_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
        runId,
        "run:fail",
        null,
        JSON.stringify({ status: "cancelled", durable_only: true }),
        now
      );
      // no live broadcast here because run is not active
      void info;
    } catch (err) {
      console.error("[dag-api] failed to persist durable stop event:", err instanceof Error ? err.message : err);
    }

    void pumpQueuedRuns("stop-durable-run");
    return c.json({ status: "cancelled", mode: "durable" });
  });

  function getLatestPendingApproval() {
    const candidates = Array.from(activeRuns.values())
      .map((entry) => ({ run: entry.run, approval: entry.run.context.__approval_request as Record<string, unknown> | undefined }))
      .filter((x) => x.approval && x.approval.status === "pending")
      .sort((a, b) => {
        const at = String(a.approval?.requested_at ?? a.run.updated_at);
        const bt = String(b.approval?.requested_at ?? b.run.updated_at);
        return at.localeCompare(bt);
      });
    return candidates[candidates.length - 1] ?? null;
  }

  // Inspect latest pending approval (for conversational approval loops)
  app.get("/api/dag/approvals/latest", (c) => {
    const latest = getLatestPendingApproval();
    if (!latest) return c.json({ pending: null });

    return c.json({
      pending: {
        run_id: latest.run.id,
        dag_name: latest.run.dag_name,
        approval: latest.approval,
      },
    });
  });

  // Decide latest pending approval without run/token (chat UX)
  app.post("/api/dag/approvals/latest", async (c) => {
    const latest = getLatestPendingApproval();
    if (!latest) return jsonError(c, 404, "No pending approval", "NO_PENDING_APPROVAL");
    const body = await c.req.json().catch(() => ({}));
    const result = await resolveApproval(latest.run.id, null, body as Record<string, unknown>);
    return c.json(result.payload, result.status);
  });

  // Auto status summary derived from roadmap + recent commits
  app.get("/api/dag/status-summary", (c) => {
    const roadmapPath = resolve(process.cwd(), "ROADMAP.md");
    let done: string[] = [];
    let todo: string[] = [];
    const doneByPriority: Record<string, string[]> = { P0: [], P1: [], P2: [], P3: [], untagged: [] };
    const todoByPriority: Record<string, string[]> = { P0: [], P1: [], P2: [], P3: [], untagged: [] };

    const detectPriority = (s: string): "P0" | "P1" | "P2" | "P3" | "untagged" => {
      const t = s.toUpperCase();
      if (/\bP0\b/.test(t) || /\burgent\b/i.test(s)) return "P0";
      if (/\bP1\b/.test(t)) return "P1";
      if (/\bP2\b/.test(t)) return "P2";
      if (/\bP3\b/.test(t)) return "P3";
      return "untagged";
    };

    if (existsSync(roadmapPath)) {
      const text = readFileSync(roadmapPath, "utf-8");
      for (const line of text.split(/\r?\n/)) {
        const m = line.match(/^\s*[-*]\s*\[(x|X| )\]\s+(.*)$/);
        if (!m) continue;
        const item = m[2].trim();
        if (!item) continue;
        const p = detectPriority(item);
        if (m[1].toLowerCase() === "x") {
          done.push(item);
          doneByPriority[p].push(item);
        } else {
          todo.push(item);
          todoByPriority[p].push(item);
        }
      }
    }

    const commits: Array<{ sha: string; subject: string }> = [];
    try {
      const r = spawnSync("git", ["-C", process.cwd(), "log", "--oneline", "-n", "20"], { encoding: "utf-8" });
      if ((r.status ?? 1) === 0) {
        for (const line of String(r.stdout || "").split(/\r?\n/)) {
          const v = line.trim();
          if (!v) continue;
          const i = v.indexOf(" ");
          if (i <= 0) continue;
          commits.push({ sha: v.slice(0, i), subject: v.slice(i + 1) });
        }
      }
    } catch {
      // ignore git errors in non-repo cwd
    }

    const tokens = (s: string) =>
      s
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, " ")
        .split(/\s+/)
        .filter((w) => w.length >= 4);

    const score = (a: string, b: string) => {
      const A = new Set(tokens(a));
      const B = new Set(tokens(b));
      if (A.size === 0 || B.size === 0) return 0;
      let inter = 0;
      for (const w of A) if (B.has(w)) inter++;
      return inter / Math.max(A.size, B.size);
    };

    const allItems = [...done, ...todo];
    const commitMatches = commits.map((c) => {
      const ranked = allItems
        .map((item) => ({ item, score: score(c.subject, item) }))
        .filter((x) => x.score >= 0.2)
        .sort((a, b) => b.score - a.score)
        .slice(0, 3)
        .map((x) => ({ item: x.item, score: Number(x.score.toFixed(2)) }));
      return { sha: c.sha, subject: c.subject, matches: ranked };
    });

    return c.json({
      generated_at: new Date().toISOString(),
      roadmap_path: existsSync(roadmapPath) ? roadmapPath : null,
      done_count: done.length,
      todo_count: todo.length,
      done: done.slice(0, 40),
      todo: todo.slice(0, 40),
      done_by_priority: doneByPriority,
      todo_by_priority: todoByPriority,
      recent_commits: commits,
      commit_matches: commitMatches,
    });
  });

  // List runs (active + durable) with simple pagination
  app.get("/api/dag/runs", (c) => {
    const limitRaw = Number(c.req.query("limit") ?? "200");
    const offsetRaw = Number(c.req.query("offset") ?? "0");
    const limit = Number.isFinite(limitRaw) ? Math.min(500, Math.max(1, Math.floor(limitRaw))) : 200;
    const offset = Number.isFinite(offsetRaw) ? Math.max(0, Math.floor(offsetRaw)) : 0;

    const active = Array.from(activeRuns.entries()).map(([id, entry]) => ({
      id,
      dag_name: entry.dag.name,
      status: entry.run.status,
      blocks: Object.fromEntries(
        Object.entries(entry.run.blocks).map(([k, v]) => [k, v.status])
      ),
      created_at: entry.run.created_at,
      durable: false,
    }));

    let durableRows = db.prepare("SELECT id, dag_name, status, run_json, created_at FROM dag_runs ORDER BY updated_at DESC LIMIT 500").all() as Array<Record<string, unknown>>;
    for (const row of durableRows) reconcileOrphanedRun(String(row.id));
    durableRows = db.prepare("SELECT id, dag_name, status, run_json, created_at FROM dag_runs ORDER BY updated_at DESC LIMIT 500").all() as Array<Record<string, unknown>>;
    const activeIds = new Set(active.map((r) => r.id));
    const durableOnly = durableRows
      .filter((r) => !activeIds.has(String(r.id)))
      .map((r) => {
        const runId = String(r.id);
        const baseRun = JSON.parse(String(r.run_json ?? "{}")) as Record<string, unknown>;
        const evs = db.prepare("SELECT event_type, block_id, data_json FROM dag_events WHERE run_id = ? ORDER BY rowid ASC").all(runId) as Array<Record<string, unknown>>;
        const run = reconstructRunFromEvents(baseRun, evs);
        const blocks = run?.blocks && typeof run.blocks === "object"
          ? Object.fromEntries(Object.entries(run.blocks as Record<string, Record<string, unknown>>).map(([k, v]) => [k, String(v.status ?? "unknown")]))
          : {};
        return {
          id: runId,
          dag_name: String(r.dag_name ?? run?.dag_name ?? "unknown"),
          status: String(r.status ?? run?.status ?? "unknown"),
          blocks,
          created_at: String(r.created_at ?? run?.created_at ?? ""),
          durable: true,
          reconstructed: true,
        };
      });

    const allRuns = [...active, ...durableOnly];
    const page = allRuns.slice(offset, offset + limit);

    return c.json({
      runs: page,
      pagination: {
        limit,
        offset,
        total: allRuns.length,
        has_more: offset + page.length < allRuns.length,
      },
    });
  });

  app.get("/api/dag/queue", (c) => {
    const rows = selectQueueOrdered.all() as Array<Record<string, unknown>>;
    const queue = rows.map((row, idx) => ({
      position: idx + 1,
      run_id: String(row.run_id ?? ""),
      status: String(row.status ?? "pending"),
      priority: Number(row.priority ?? 0),
      manual_rank: row.manual_rank === null || row.manual_rank === undefined ? null : Number(row.manual_rank),
      claim_owner: row.claim_owner ? String(row.claim_owner) : null,
      attempt: Number(row.attempt ?? 0),
      created_at: String(row.created_at ?? ""),
      updated_at: String(row.updated_at ?? ""),
      started_at: row.started_at ? String(row.started_at) : null,
      finished_at: row.finished_at ? String(row.finished_at) : null,
      last_error: row.last_error ? String(row.last_error) : null,
    }));

    return c.json({
      queue,
      policy: {
        order: "manual_rank (override) > priority (desc) > created_at (asc)",
        active_limit: safety.maxConcurrentRuns,
      },
    });
  });

  app.patch("/api/dag/queue/:id", async (c) => {
    const runId = c.req.param("id");
    const body = await c.req.json().catch(() => ({}));
    const row = selectQueueByRun.get(runId) as Record<string, unknown> | undefined;
    if (!row) return jsonError(c, 404, "Queue item not found", "NOT_FOUND");
    const status = String(row.status ?? "");
    if (status !== "pending") return jsonError(c, 409, `Queue item is not pending (status=${status})`, "INVALID_STATE");

    const nextPriority = body.priority === undefined ? Number(row.priority ?? 0) : normalizePriority(body.priority);
    const nextManualRank = body.manual_rank === undefined && body.manualRank === undefined
      ? (row.manual_rank === null || row.manual_rank === undefined ? null : Number(row.manual_rank))
      : parseManualRank(body.manual_rank ?? body.manualRank);

    const now = new Date().toISOString();
    db.prepare("UPDATE dag_run_queue SET priority = ?, manual_rank = ?, updated_at = ? WHERE run_id = ?").run(
      nextPriority,
      nextManualRank,
      now,
      runId
    );

    void pumpQueuedRuns("queue-patch");

    const updated = selectQueueByRun.get(runId) as Record<string, unknown> | undefined;
    return c.json({
      ok: true,
      item: {
        run_id: runId,
        status: String(updated?.status ?? status),
        priority: Number(updated?.priority ?? nextPriority),
        manual_rank: updated?.manual_rank === null || updated?.manual_rank === undefined ? null : Number(updated.manual_rank),
      },
    });
  });

  app.post("/api/dag/queue/reorder", async (c) => {
    const body = await c.req.json().catch(() => ({}));
    const runId = String(body.run_id ?? "").trim();
    if (!runId) return jsonError(c, 400, "run_id is required", "INVALID_INPUT");

    const row = selectQueueByRun.get(runId) as Record<string, unknown> | undefined;
    if (!row) return jsonError(c, 404, "Queue item not found", "NOT_FOUND");
    const status = String(row.status ?? "");
    if (status !== "pending") return jsonError(c, 409, `Queue item is not pending (status=${status})`, "INVALID_STATE");

    const rank = parseManualRank(body.manual_rank ?? body.manualRank);
    const now = new Date().toISOString();
    db.prepare("UPDATE dag_run_queue SET manual_rank = ?, updated_at = ? WHERE run_id = ?").run(rank, now, runId);

    void pumpQueuedRuns("queue-reorder");

    return c.json({ ok: true, run_id: runId, manual_rank: rank });
  });

  return app;
}

function runCommand(cmd: string, args: string[], timeoutSec: number): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, {
      env: { ...process.env },
      stdio: ["pipe", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";
    let killed = false;

    child.stdout.on("data", (chunk: Buffer) => { stdout += chunk.toString(); });
    child.stderr.on("data", (chunk: Buffer) => { stderr += chunk.toString(); });

    const timer = setTimeout(() => {
      killed = true;
      child.kill("SIGKILL");
      reject(new Error(`Command timed out after ${timeoutSec}s`));
    }, timeoutSec * 1000);

    child.on("close", (code: number | null) => {
      clearTimeout(timer);
      if (!killed) resolve({ stdout, stderr, exitCode: code ?? 1 });
    });
    child.on("error", (err: Error) => {
      clearTimeout(timer);
      reject(err);
    });
  });
}
