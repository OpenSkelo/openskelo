import chalk from "chalk";
import { loadConfig } from "../core/config.js";
import { createDB } from "../core/db.js";
import { createTaskEngine } from "../core/task-engine.js";
import { createGateEngine } from "../core/gate-engine.js";
import { createRouter } from "../core/router.js";
import { createAPI } from "../server/api.js";
import { createRunEngine } from "../core/run-engine.js";
import { createDAGAPI } from "../server/dag-api.js";
import { getDAGDashboardHTML } from "../server/dag-dashboard.js";

export async function startServer(opts: { port: number; dashboard: boolean }) {
  console.log(chalk.hex("#f97316")(`\n🦴 OpenSkelo starting...\n`));

  // Load config
  let config;
  try {
    config = loadConfig();
    console.log(chalk.green("  ✓ ") + `Config loaded: ${config.name}`);
  } catch (err) {
    console.error(chalk.red(`  ✗ ${(err as Error).message}`));
    process.exit(1);
  }

  // Initialize database
  const db = createDB();
  console.log(chalk.green("  ✓ ") + "Database initialized (.skelo/skelo.db)");

  // Sync agents from config to DB
  const syncAgent = db.prepare(`
    INSERT OR REPLACE INTO agents (id, role, capabilities, provider, model, config)
    VALUES (?, ?, ?, ?, ?, ?)
  `);
  for (const [id, agent] of Object.entries(config.agents)) {
    syncAgent.run(
      id,
      agent.role,
      JSON.stringify(agent.capabilities),
      agent.provider,
      agent.model,
      JSON.stringify(agent.config ?? {})
    );
  }
  const agentCount = Object.keys(config.agents).length;
  console.log(chalk.green("  ✓ ") + `${agentCount} agent${agentCount !== 1 ? "s" : ""} registered`);

  // Initialize engines
  const taskEngine = createTaskEngine(config.pipelines);
  const gateEngine = createGateEngine(config.gates);
  const router = createRouter(config.agents, config.pipelines);
  const runEngine = createRunEngine();

  const pipelineCount = Object.keys(config.pipelines).length;
  const gateCount = config.gates.length;
  console.log(chalk.green("  ✓ ") + `${pipelineCount} pipeline${pipelineCount !== 1 ? "s" : ""}, ${gateCount} gate${gateCount !== 1 ? "s" : ""}`);

  // Start server
  const app = createAPI({ config, taskEngine, gateEngine, router, runEngine });

  // Mount DAG API and dashboard
  const { resolve: pathResolve } = await import("node:path");
  const { findConfigFile } = await import("../core/config.js");
  const configPath = findConfigFile();
  const projectRoot = configPath ? pathResolve(configPath, "..") : process.cwd();
  const examplesDir = pathResolve(projectRoot, "examples");
  const dagAPI = createDAGAPI(config, { examplesDir });
  app.route("/", dagAPI);

  app.get("/dag", (c) => c.html(getDAGDashboardHTML(config.name, opts.port, { liveMode: false })));
  app.get("/dag/live", (c) => c.html(getDAGDashboardHTML(config.name, opts.port, { liveMode: true })));

  await startNodeServer(app, opts.port);

  console.log();
  console.log(chalk.hex("#f97316")("  🔥 OpenSkelo running"));
  console.log();
  console.log(chalk.dim("  Pipeline:  ") + `http://localhost:${opts.port}`);
  if (opts.dashboard) {
    console.log(chalk.dim("  Dashboard: ") + `http://localhost:${opts.port}/dashboard`);
  }
  console.log(chalk.dim("  DAG Runner:") + `http://localhost:${opts.port}/dag`);
  console.log(chalk.dim("  Live View: ") + `http://localhost:${opts.port}/dag/live`);
  console.log(chalk.dim("  API:       ") + `http://localhost:${opts.port}/api`);
  console.log();

  // Print agents
  for (const [id, agent] of Object.entries(config.agents)) {
    const icon = agent.role === "worker" ? "🔧" : agent.role === "reviewer" ? "🔍" : "🧠";
    console.log(chalk.dim(`  ${icon} ${id}`) + chalk.dim(` (${agent.role}, ${agent.model})`));
  }
  console.log();
}

async function startNodeServer(app: ReturnType<typeof createAPI>, port: number) {
  const { serve } = await import("@hono/node-server");
  return serve({ fetch: app.fetch, port });
}
