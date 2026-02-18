import { Hono } from "hono";
import { cors } from "hono/cors";
import type { SkeloConfig } from "../types.js";

interface APIContext {
  config: SkeloConfig;
}

export function createAPI(ctx: APIContext) {
  const app = new Hono();
  const { config } = ctx;

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

  app.get("/api/agents", (c) => {
    const agents = Object.entries(config.agents).map(([id, agent]) => ({ id, ...agent }));
    return c.json({ agents });
  });

  app.get("/api/gates", (c) => c.json({ gates: config.gates }));


  if (config.dashboard.enabled) {
    app.get("/dashboard", (c) => c.redirect("/dag"));
    app.get("/", (c) => c.redirect("/dag"));
  }

  return app;
}
