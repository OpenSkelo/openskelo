import { Hono } from "hono";
import { cors } from "hono/cors";
import { getDB } from "../core/db.js";
import type { SkeloConfig } from "../types.js";
import type { createTaskEngine } from "../core/task-engine.js";
import type { createGateEngine } from "../core/gate-engine.js";
import type { createRouter } from "../core/router.js";

interface APIContext {
  config: SkeloConfig;
  taskEngine?: ReturnType<typeof createTaskEngine>;
  gateEngine?: ReturnType<typeof createGateEngine>;
  router?: ReturnType<typeof createRouter>;
}

export function createAPI(ctx: APIContext) {
  const app = new Hono();
  const { config, taskEngine, gateEngine } = ctx;
  const hasLegacyTaskRuntime = Boolean(taskEngine && gateEngine);

  const markLegacyTaskApiDeprecation = (c: { header: (name: string, value: string) => void }) => {
    c.header("Deprecation", "true");
    c.header("Sunset", "next-release");
    c.header("Link", '</api/dag>; rel="successor-version"');
    c.header("Warning", '299 - "Legacy /api/tasks* endpoints are deprecated; use /api/dag/*"');
  };

  app.use("*", cors());

  app.get("/api/health", (c) => {
    return c.json({
      status: "ok",
      name: config.name,
      agents: Object.keys(config.agents).length,
      pipelines: Object.keys(config.pipelines).length,
      gates: config.gates.length,
    });
  });

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

  if (hasLegacyTaskRuntime) {
    app.get("/api/tasks", (c) => {
      markLegacyTaskApiDeprecation(c);
      const status = c.req.query("status");
      const pipeline = c.req.query("pipeline");
      const tasks = taskEngine!.list({ status, pipeline });
      return c.json({ tasks });
    });

    app.get("/api/tasks/:id", (c) => {
      markLegacyTaskApiDeprecation(c);
      const task = taskEngine!.getById(c.req.param("id"));
      if (!task) return c.json({ error: "Not found" }, 404);
      return c.json({ task });
    });

    app.post("/api/tasks", async (c) => {
      markLegacyTaskApiDeprecation(c);
      const body = await c.req.json();
      if (!body.pipeline) return c.json({ error: "pipeline is required" }, 400);
      if (!body.title) return c.json({ error: "title is required" }, 400);

      try {
        const task = taskEngine!.create({
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
      markLegacyTaskApiDeprecation(c);
      const id = c.req.param("id");
      const body = await c.req.json();

      const task = taskEngine!.getById(id);
      if (!task) return c.json({ error: "Not found" }, 404);

      if (body.status && body.status !== task.status) {
        const results = gateEngine!.evaluate(
          task,
          task.status,
          body.status,
          { assigned: body.assigned, notes: body.notes },
          body.role
        );

        const failed = gateEngine!.hasFailed(results);
        if (failed) {
          return c.json({ error: failed.reason, gate: failed.name, results }, 400);
        }

        try {
          const updated = taskEngine!.transition(
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

    app.get("/api/tasks/counts", (c) => {
      markLegacyTaskApiDeprecation(c);
      return c.json(taskEngine!.counts());
    });
  }

  app.get("/api/agents", (c) => {
    const agents = Object.entries(config.agents).map(([id, agent]) => ({ id, ...agent }));
    return c.json({ agents });
  });

  app.get("/api/gates", (c) => c.json({ gates: config.gates }));

  app.get("/api/logs", (c) => {
    const db = getDB();
    const taskId = c.req.query("task");
    const limit = parseInt(c.req.query("limit") ?? "50", 10);

    let rows;
    if (taskId) {
      rows = db
        .prepare("SELECT * FROM audit_log WHERE task_id = ? ORDER BY created_at DESC LIMIT ?")
        .all(taskId, limit);
    } else {
      rows = db.prepare("SELECT * FROM audit_log ORDER BY created_at DESC LIMIT ?").all(limit);
    }

    return c.json({ logs: rows });
  });

  app.get("/api/gate-log", (c) => {
    const db = getDB();
    const taskId = c.req.query("task");
    const limit = parseInt(c.req.query("limit") ?? "50", 10);

    let rows;
    if (taskId) {
      rows = db
        .prepare("SELECT * FROM gate_log WHERE task_id = ? ORDER BY created_at DESC LIMIT ?")
        .all(taskId, limit);
    } else {
      rows = db.prepare("SELECT * FROM gate_log ORDER BY created_at DESC LIMIT ?").all(limit);
    }

    return c.json({ gateLogs: rows });
  });

  if (config.dashboard.enabled) {
    app.get("/dashboard", (c) => c.redirect("/dag"));
    app.get("/", (c) => c.redirect("/dag"));
  }

  return app;
}
