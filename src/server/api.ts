import { Hono } from "hono";
import { cors } from "hono/cors";
import { getDB } from "../core/db.js";
import { getDashboardHTML } from "./dashboard.js";
import type { SkeloConfig, RunContext, RunStepInput } from "../types.js";
import type { createTaskEngine } from "../core/task-engine.js";
import type { createGateEngine } from "../core/gate-engine.js";
import type { createRouter } from "../core/router.js";
import type { createRunEngine } from "../core/run-engine.js";

interface APIContext {
  config: SkeloConfig;
  taskEngine: ReturnType<typeof createTaskEngine>;
  gateEngine: ReturnType<typeof createGateEngine>;
  router: ReturnType<typeof createRouter>;
  runEngine: ReturnType<typeof createRunEngine>;
}

export function createAPI(ctx: APIContext) {
  const app = new Hono();
  const { config, taskEngine, gateEngine, runEngine } = ctx;

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

    if (body.status && body.status !== task.status) {
      const results = gateEngine.evaluate(
        task,
        task.status,
        body.status,
        { assigned: body.assigned, notes: body.notes },
        body.role
      );

      const failed = gateEngine.hasFailed(results);
      if (failed) {
        return c.json({ error: failed.reason, gate: failed.name, results }, 400);
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

  app.get("/api/tasks/counts", () => c.json(taskEngine.counts()));

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

  // Block Core MVP endpoints
  app.post("/api/runs", async (c) => {
    const raw = await c.req.json();
    const parsed = parseCreateRunBody(raw);
    if (!parsed.ok) return c.json({ error: parsed.error }, 400);

    const run = runEngine.createRun({
      originalPrompt: parsed.value.original_prompt,
      context: parsed.value.context,
    });

    return c.json({ run }, 201);
  });

  app.get("/api/runs/:id", (c) => {
    const run = runEngine.getRun(c.req.param("id"));
    if (!run) return c.json({ error: "Not found" }, 404);
    return c.json({ run, events: runEngine.getEvents(run.id), steps: runEngine.listSteps(run.id) });
  });

  app.get("/api/runs/:id/steps", (c) => {
    const run = runEngine.getRun(c.req.param("id"));
    if (!run) return c.json({ error: "Not found" }, 404);
    return c.json({ steps: runEngine.listSteps(run.id) });
  });

  app.post("/api/runs/:id/step", async (c) => {
    const raw = await c.req.json().catch(() => ({}));
    const parsed = parseStepInput(raw);
    if (!parsed.ok) return c.json({ error: parsed.error }, 400);

    const result = runEngine.step(c.req.param("id"), parsed.value);
    if (!result.ok) {
      return c.json({ error: result.error, gate: result.gate }, result.status);
    }

    return c.json({ run: result.run, events: runEngine.getEvents(result.run.id) });
  });

  app.get("/api/runs/:id/context", (c) => {
    const run = runEngine.getRun(c.req.param("id"));
    if (!run) return c.json({ error: "Not found" }, 404);
    return c.json({ context: run.context });
  });

  app.post("/api/runs/:id/context", async (c) => {
    const raw = await c.req.json();
    if (!isPlainObject(raw)) return c.json({ error: "context body must be an object" }, 400);

    try {
      const run = runEngine.setContext(c.req.param("id"), raw as RunContext);
      return c.json({ context: run.context });
    } catch (err) {
      return c.json({ error: (err as Error).message }, 404);
    }
  });

  app.get("/api/runs/:id/artifact", (c) => {
    const artifact = runEngine.getArtifact(c.req.param("id"));
    if (!artifact) return c.json({ error: "Not found" }, 404);
    return c.json(artifact);
  });

  if (config.dashboard.enabled) {
    app.get("/dashboard", (c) => c.html(getDashboardHTML(config.name, config.dashboard.port)));
    app.get("/", (c) => c.redirect("/dashboard"));
  }

  return app;
}

function parseCreateRunBody(raw: unknown):
  | { ok: true; value: { original_prompt: string; context?: RunContext } }
  | { ok: false; error: string } {
  if (!isPlainObject(raw)) return { ok: false, error: "Body must be an object" };

  const prompt = raw.original_prompt;
  if (typeof prompt !== "string" || prompt.trim().length === 0) {
    return { ok: false, error: "original_prompt is required" };
  }

  if (raw.context !== undefined && !isPlainObject(raw.context)) {
    return { ok: false, error: "context must be an object" };
  }

  return {
    ok: true,
    value: { original_prompt: prompt.trim(), context: raw.context as RunContext | undefined },
  };
}

function parseStepInput(raw: unknown):
  | { ok: true; value: RunStepInput }
  | { ok: false; error: string } {
  if (raw === null || raw === undefined) return { ok: true, value: {} };
  if (!isPlainObject(raw)) return { ok: false, error: "Body must be an object" };

  if (raw.reviewApproved !== undefined && typeof raw.reviewApproved !== "boolean") {
    return { ok: false, error: "reviewApproved must be a boolean" };
  }

  if (raw.contextPatch !== undefined && !isPlainObject(raw.contextPatch)) {
    return { ok: false, error: "contextPatch must be an object" };
  }

  return {
    ok: true,
    value: {
      reviewApproved: raw.reviewApproved as boolean | undefined,
      contextPatch: raw.contextPatch as RunContext | undefined,
    },
  };
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
