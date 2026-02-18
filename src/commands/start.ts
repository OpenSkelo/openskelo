import chalk from "chalk";
import { loadConfig } from "../core/config.js";
import { createDB } from "../core/db.js";
import { createAPI } from "../server/api.js";
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
  createDB();
  console.log(chalk.green("  ✓ ") + "Database initialized (.skelo/skelo.db)");

  const agentCount = Object.keys(config.agents).length;
  console.log(chalk.green("  ✓ ") + `${agentCount} agent${agentCount !== 1 ? "s" : ""} configured`);

  const pipelineCount = Object.keys(config.pipelines).length;
  const gateCount = config.gates.length;
  console.log(chalk.green("  ✓ ") + `${pipelineCount} pipeline${pipelineCount !== 1 ? "s" : ""}, ${gateCount} gate${gateCount !== 1 ? "s" : ""}`);

  // Start server (DAG-first base API)
  const app = createAPI({ config });

  // Mount DAG API and dashboard
  const { resolve: pathResolve } = await import("node:path");
  const { findConfigFile } = await import("../core/config.js");
  const configPath = findConfigFile();
  const projectRoot = configPath ? pathResolve(configPath, "..") : process.cwd();
  const examplesDir = pathResolve(projectRoot, "examples");
  const { existsSync } = await import("node:fs");
  const docsCandidates = [
    pathResolve(projectRoot, "docs", "visual"),
    pathResolve(projectRoot, "docs"),
    pathResolve(projectRoot, "..", "docs", "visual"),
  ];
  const docsDir = docsCandidates.find((d) => existsSync(d)) ?? docsCandidates[0];
  const dagAPI = createDAGAPI(config, { examplesDir });
  app.route("/", dagAPI);

  // Single canonical DAG UI (live features included)
  app.get("/dag", (c) => c.html(getDAGDashboardHTML(config.name, opts.port, { liveMode: true })));
  // Backward-compatible alias
  app.get("/dag/live", (c) => c.redirect('/dag'));

  // Visual docs (optional, observer-only docs pages)
  const docsAliases: Record<string, string> = {
    visualizer: "generic-block-visualizer.html",
    overview: "overview.html",
    explainer: "generic-block-explainer.html",
    architecture: "full-stack-architecture.html",
    roadmap: "visual-roadmap.html",
    status: "status-checklist.html",
  };

  const serveDoc = async (name: string) => {
    const { readFile } = await import("node:fs/promises");
    const { basename } = await import("node:path");

    const resolved = docsAliases[name] ?? name;
    if (!resolved.endsWith(".html") || basename(resolved) !== resolved) {
      return null;
    }

    try {
      return await readFile(pathResolve(docsDir, resolved), "utf8");
    } catch {
      return null;
    }
  };

  app.get("/docs", (c) => c.redirect("/doc/visualizer"));
  app.get("/doc", (c) => c.redirect("/doc/visualizer"));

  app.get("/docs/:name", async (c) => {
    const name = c.req.param("name");
    if (name in docsAliases && name !== "visualizer") {
      return c.redirect(`/doc/visualizer?tab=${encodeURIComponent(name)}`);
    }
    const html = await serveDoc(name);
    if (!html) return c.text("Not found", 404);
    return c.html(html);
  });

  app.get("/doc/:name", async (c) => {
    const name = c.req.param("name");
    if (name in docsAliases && name !== "visualizer") {
      return c.redirect(`/doc/visualizer?tab=${encodeURIComponent(name)}`);
    }
    const html = await serveDoc(name);
    if (!html) return c.text("Not found", 404);
    return c.html(html);
  });

  await startNodeServer(app, opts.port);

  console.log();
  console.log(chalk.hex("#f97316")("  🔥 OpenSkelo running"));
  console.log();
  console.log(chalk.dim("  Runtime:   ") + `http://localhost:${opts.port}`);
  console.log(chalk.dim("  DAG UI:    ") + `http://localhost:${opts.port}/dag`);
  console.log(chalk.dim("  Docs:      ") + `http://localhost:${opts.port}/docs`);
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
