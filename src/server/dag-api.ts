/**
 * DAG API — endpoints + SSE for real-time DAG execution.
 */

import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { parse as parseYaml } from "yaml";
import { createBlockEngine } from "../core/block.js";
import { createDAGExecutor } from "../core/dag-executor.js";
import { createOpenClawProvider } from "../core/openclaw-provider.js";
import type { DAGDef, DAGRun, BlockInstance } from "../core/block.js";
import type { ExecutorResult, TraceEntry } from "../core/dag-executor.js";
import type { SkeloConfig } from "../types.js";

interface DAGEvent {
  type: "run:start" | "block:start" | "block:complete" | "block:fail" | "run:complete" | "run:fail";
  run_id: string;
  block_id?: string;
  data: Record<string, unknown>;
  timestamp: string;
}

// In-memory store for active runs + events
const activeRuns = new Map<string, { dag: DAGDef; run: DAGRun; result?: ExecutorResult }>();
const runEvents = new Map<string, DAGEvent[]>();
const sseClients = new Map<string, Set<(event: DAGEvent) => void>>();

export function createDAGAPI(config: SkeloConfig, opts?: { examplesDir?: string }) {
  const app = new Hono();
  const engine = createBlockEngine();
  const examplesBaseDir = opts?.examplesDir ?? resolve(process.cwd(), "examples");

  // Broadcast event to all SSE clients for a run
  function broadcast(runId: string, event: DAGEvent) {
    const events = runEvents.get(runId) ?? [];
    events.push(event);
    runEvents.set(runId, events);

    const clients = sseClients.get(runId);
    if (clients) {
      for (const cb of clients) cb(event);
    }
  }

  // List available example DAGs
  app.get("/api/dag/examples", (c) => {
    const examples: { name: string; file: string }[] = [];

    for (const file of ["coding-pipeline.yaml", "research-pipeline.yaml", "content-pipeline.yaml"]) {
      const path = resolve(examplesBaseDir, file);
      if (existsSync(path)) {
        try {
          const raw = parseYaml(readFileSync(path, "utf-8"));
          examples.push({ name: raw.name ?? file, file });
        } catch { /* skip bad files */ }
      }
    }

    return c.json({ examples });
  });

  // Get a DAG definition (parsed)
  app.get("/api/dag/examples/:file", (c) => {
    const file = c.req.param("file");
    const path = resolve(examplesBaseDir, file);
    if (!existsSync(path)) return c.json({ error: "Not found" }, 404);

    try {
      const raw = parseYaml(readFileSync(path, "utf-8"));
      const dag = engine.parseDAG(raw);
      return c.json({ dag, order: engine.executionOrder(dag) });
    } catch (err) {
      return c.json({ error: (err as Error).message }, 400);
    }
  });

  // Start a DAG run
  app.post("/api/dag/run", async (c) => {
    const body = await c.req.json();
    const file = body.example as string | undefined;
    const context = (body.context as Record<string, unknown>) ?? {};

    let dag: DAGDef;
    try {
      if (file) {
        const path = resolve(examplesBaseDir, file);
        if (!existsSync(path)) return c.json({ error: "Example not found" }, 404);
        const raw = parseYaml(readFileSync(path, "utf-8"));
        dag = engine.parseDAG(raw);
      } else if (body.dag) {
        dag = engine.parseDAG(body.dag);
      } else {
        return c.json({ error: "Provide 'example' filename or 'dag' definition" }, 400);
      }
    } catch (err) {
      return c.json({ error: (err as Error).message }, 400);
    }

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

    // Choose provider: "openclaw" for real agents, "mock" for simulation
    const providerMode = (body.provider as string) ?? "openclaw";

    if (providerMode !== "openclaw") {
      return c.json({ error: "Only provider=openclaw is enabled in this build" }, 400);
    }

    const provider = createOpenClawProvider({
      agentMapping: body.agentMapping as Record<string, string> | undefined,
      timeoutSeconds: (body.timeoutSeconds as number) ?? 300,
      model: body.model as string | undefined,
      thinking: body.thinking as string | undefined,
    });

    const providers: Record<string, typeof provider> = {};
    for (const p of config.providers) {
      providers[p.name] = provider;
    }

    // Create executor with event hooks
    const executor = createDAGExecutor({
      providers,
      agents,
      maxParallel: 4,
      onBlockStart: (run, blockId) => {
        broadcast(run.id, {
          type: "block:start",
          run_id: run.id,
          block_id: blockId,
          data: { instance: run.blocks[blockId] },
          timestamp: new Date().toISOString(),
        });
      },
      onBlockComplete: (run, blockId) => {
        broadcast(run.id, {
          type: "block:complete",
          run_id: run.id,
          block_id: blockId,
          data: { instance: run.blocks[blockId] },
          timestamp: new Date().toISOString(),
        });
      },
      onBlockFail: (run, blockId, error) => {
        broadcast(run.id, {
          type: "block:fail",
          run_id: run.id,
          block_id: blockId,
          data: { error, instance: run.blocks[blockId] },
          timestamp: new Date().toISOString(),
        });
      },
      onRunComplete: (run) => {
        broadcast(run.id, {
          type: "run:complete",
          run_id: run.id,
          data: { status: run.status },
          timestamp: new Date().toISOString(),
        });
      },
      onRunFail: (run) => {
        broadcast(run.id, {
          type: "run:fail",
          run_id: run.id,
          data: { status: run.status },
          timestamp: new Date().toISOString(),
        });
      },
    });

    // Create initial run state for immediate response
    const initialRun = engine.createRun(dag, context);
    activeRuns.set(initialRun.id, { dag, run: initialRun });
    runEvents.set(initialRun.id, []);

    broadcast(initialRun.id, {
      type: "run:start",
      run_id: initialRun.id,
      data: { dag_name: dag.name, blocks: dag.blocks.map(b => b.id) },
      timestamp: new Date().toISOString(),
    });

    // Execute asynchronously — pass the stored run reference so mutations are visible
    executor.execute(dag, context, initialRun).then((result) => {
      const entry = activeRuns.get(initialRun.id);
      if (entry) {
        entry.result = result;
      }
    }).catch((err) => {
      console.error("[dag-api] Run failed:", err);
    });

    return c.json({
      run_id: initialRun.id,
      dag_name: dag.name,
      blocks: dag.blocks.map(b => ({ id: b.id, name: b.name })),
      edges: dag.edges,
      sse_url: `/api/dag/runs/${initialRun.id}/events`,
    }, 201);
  });

  // Get run status
  app.get("/api/dag/runs/:id", (c) => {
    const entry = activeRuns.get(c.req.param("id"));
    if (!entry) return c.json({ error: "Not found" }, 404);
    return c.json({
      run: entry.run,
      dag: entry.dag,
      events: runEvents.get(entry.run.id) ?? [],
      trace: entry.result?.trace ?? [],
    });
  });

  // SSE stream for real-time events
  app.get("/api/dag/runs/:id/events", (c) => {
    const runId = c.req.param("id");
    if (!activeRuns.has(runId)) return c.json({ error: "Not found" }, 404);

    return streamSSE(c, async (stream) => {
      // Send existing events first (replay)
      const existing = runEvents.get(runId) ?? [];
      for (const event of existing) {
        await stream.writeSSE({
          event: event.type,
          data: JSON.stringify(event),
        });
      }

      // Register for new events
      const clients = sseClients.get(runId) ?? new Set();
      const handler = async (event: DAGEvent) => {
        try {
          await stream.writeSSE({
            event: event.type,
            data: JSON.stringify(event),
          });
        } catch {
          clients.delete(handler);
        }
      };
      clients.add(handler);
      sseClients.set(runId, clients);

      // Keep alive until run completes or client disconnects
      const entry = activeRuns.get(runId);
      while (entry && entry.run.status !== "completed" && entry.run.status !== "failed" && entry.run.status !== "cancelled") {
        await new Promise(r => setTimeout(r, 500));
      }

      // Final keepalive then close
      await new Promise(r => setTimeout(r, 1000));
      clients.delete(handler);
    });
  });

  // Stop/cancel a run
  app.post("/api/dag/runs/:id/stop", (c) => {
    const entry = activeRuns.get(c.req.param("id"));
    if (!entry) return c.json({ error: "Not found" }, 404);

    entry.run.status = "cancelled";
    for (const block of Object.values(entry.run.blocks)) {
      if (block.status === "running" || block.status === "pending" || block.status === "ready") {
        block.status = "skipped";
      }
    }

    broadcast(c.req.param("id"), {
      type: "run:fail",
      run_id: entry.run.id,
      data: { status: "cancelled" },
      timestamp: new Date().toISOString(),
    });

    return c.json({ status: "cancelled" });
  });

  // List all runs
  app.get("/api/dag/runs", (c) => {
    const runs = Array.from(activeRuns.entries()).map(([id, entry]) => ({
      id,
      dag_name: entry.dag.name,
      status: entry.run.status,
      blocks: Object.fromEntries(
        Object.entries(entry.run.blocks).map(([k, v]) => [k, v.status])
      ),
      created_at: entry.run.created_at,
    }));
    return c.json({ runs });
  });

  return app;
}
