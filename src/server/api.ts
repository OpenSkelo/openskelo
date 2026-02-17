import { Hono } from "hono";
import { cors } from "hono/cors";
import type { SkeloConfig } from "../types.js";
import type { createTaskEngine } from "../core/task-engine.js";
import type { createGateEngine } from "../core/gate-engine.js";
import type { createRouter } from "../core/router.js";

interface APIContext {
  config: SkeloConfig;
  taskEngine: ReturnType<typeof createTaskEngine>;
  gateEngine: ReturnType<typeof createGateEngine>;
  router: ReturnType<typeof createRouter>;
}

export function createAPI(ctx: APIContext) {
  const app = new Hono();
  const { config, taskEngine, gateEngine, router } = ctx;

  app.use("*", cors());

  // ── Health ──
  app.get("/api/health", (c) => {
    return c.json({
      status: "ok",
      name: config.name,
      agents: Object.keys(config.agents).length,
      pipelines: Object.keys(config.pipelines).length,
      gates: config.gates.length,
    });
  });

  // ── Config ──
  app.get("/api/config", (c) => {
    return c.json({
      name: config.name,
      pipelines: config.pipelines,
      agents: Object.fromEntries(
        Object.entries(config.agents).map(([id, a]) => [
          id,
          { role: a.role, capabilities: a.capabilities, model: a.model },
        ])
      ),
      gates: config.gates.map((g) => ({ name: g.name, on: g.on, error: g.error })),
    });
  });

  // ── Tasks ──
  app.get("/api/tasks", (c) => {
    const status = c.req.query("status");
    const pipeline = c.req.query("pipeline");
    const tasks = taskEngine.list({ status, pipeline });
    return c.json({ tasks });
  });

  app.get("/api/tasks/:id", (c) => {
    const task = taskEngine.getById(c.req.param("id"));
    if (!task) return c.json({ error: "Not found" }, 404);
    return c.json({ task });
  });

  app.post("/api/tasks", async (c) => {
    const body = await c.req.json();

    if (!body.pipeline) return c.json({ error: "pipeline is required" }, 400);
    if (!body.title) return c.json({ error: "title is required" }, 400);

    try {
      const task = taskEngine.create({
        pipeline: body.pipeline,
        title: body.title,
        description: body.description,
        assigned: body.assigned,
        priority: body.priority,
        metadata: body.metadata,
      });
      return c.json({ task }, 201);
    } catch (err) {
      return c.json({ error: (err as Error).message }, 400);
    }
  });

  app.patch("/api/tasks/:id", async (c) => {
    const id = c.req.param("id");
    const body = await c.req.json();

    const task = taskEngine.getById(id);
    if (!task) return c.json({ error: "Not found" }, 404);

    // Status transition
    if (body.status && body.status !== task.status) {
      // Run gates
      const results = gateEngine.evaluate(
        task,
        task.status,
        body.status,
        { assigned: body.assigned, notes: body.notes },
        body.role
      );

      const failed = gateEngine.hasFailed(results);
      if (failed) {
        return c.json(
          {
            error: failed.reason,
            gate: failed.name,
            results: results,
          },
          400
        );
      }

      try {
        const updated = taskEngine.transition(
          id,
          body.status,
          { assigned: body.assigned, notes: body.notes, metadata: body.metadata },
          body.agent ?? "api",
          results
        );

        return c.json({ task: updated, gates: results });
      } catch (err) {
        return c.json({ error: (err as Error).message }, 400);
      }
    }

    return c.json({ error: "No status change provided" }, 400);
  });

  // ── Task Counts ──
  app.get("/api/tasks/counts", (c) => {
    return c.json(taskEngine.counts());
  });

  // ── Agents ──
  app.get("/api/agents", (c) => {
    const agents = Object.entries(config.agents).map(([id, agent]) => ({
      id,
      ...agent,
    }));
    return c.json({ agents });
  });

  // ── Gates ──
  app.get("/api/gates", (c) => {
    return c.json({ gates: config.gates });
  });

  // ── Audit Log ──
  app.get("/api/logs", (c) => {
    const { getDB } = require("../core/db.js");
    const db = getDB();
    const taskId = c.req.query("task");
    const limit = parseInt(c.req.query("limit") ?? "50");

    let rows;
    if (taskId) {
      rows = db
        .prepare("SELECT * FROM audit_log WHERE task_id = ? ORDER BY created_at DESC LIMIT ?")
        .all(taskId, limit);
    } else {
      rows = db
        .prepare("SELECT * FROM audit_log ORDER BY created_at DESC LIMIT ?")
        .all(limit);
    }

    return c.json({ logs: rows });
  });

  // ── Gate Log ──
  app.get("/api/gate-log", (c) => {
    const { getDB } = require("../core/db.js");
    const db = getDB();
    const taskId = c.req.query("task");
    const limit = parseInt(c.req.query("limit") ?? "50");

    let rows;
    if (taskId) {
      rows = db
        .prepare("SELECT * FROM gate_log WHERE task_id = ? ORDER BY created_at DESC LIMIT ?")
        .all(taskId, limit);
    } else {
      rows = db
        .prepare("SELECT * FROM gate_log ORDER BY created_at DESC LIMIT ?")
        .all(limit);
    }

    return c.json({ gateLogs: rows });
  });

  // ── Dashboard (placeholder) ──
  if (config.dashboard.enabled) {
    app.get("/dashboard", (c) => {
      return c.html(`
        <!DOCTYPE html>
        <html>
        <head>
          <title>${config.name} — OpenSkelo Dashboard</title>
          <style>
            body { background: #0a0a0f; color: #e0e0e0; font-family: system-ui; padding: 40px; }
            h1 { color: #f97316; }
            .status { color: #22c55e; }
          </style>
        </head>
        <body>
          <h1>🦴 ${config.name}</h1>
          <p class="status">OpenSkelo is running</p>
          <p>Dashboard UI coming soon. API available at <a href="/api/health" style="color:#f97316">/api/health</a></p>
        </body>
        </html>
      `);
    });
  }

  return app;
}
