import { Command } from "commander";
import chalk from "chalk";
import { initProject } from "./commands/init.js";
import { startServer } from "./commands/start.js";
import { statusCommand } from "./commands/status.js";
import { runCommands } from "./commands/run.js";
import { autopilotCommand } from "./commands/autopilot.js";
import { killCommand } from "./commands/kill.js";
import { watchCommand } from "./commands/watch.js";

const VERSION = "0.1.0";

const logo = `
  ╔═╗╔═╗╔═╗╔╗╔  ╔═╗╦╔═╔═╗╦  ╔═╗
  ║ ║╠═╝║╣ ║║║  ╚═╗╠╩╗║╣ ║  ║ ║
  ╚═╝╩  ╚═╝╝╚╝  ╚═╝╩ ╩╚═╝╩═╝╚═╝
`;

const program = new Command();

program
  .name("skelo")
  .description(
    chalk.dim("Give your AI agents a backbone.\n") +
    chalk.dim("Deterministic pipeline runtime — local-first, config-driven, zero cost.")
  )
  .version(VERSION)
  .addHelpText("beforeAll", chalk.hex("#f97316")(logo));

// ── init ──
program
  .command("init [name]")
  .description("Create a new OpenSkelo pipeline project")
  .option("-t, --template <template>", "Use a preset template", "coding")
  .action(async (name, opts) => {
    await initProject(name, opts.template);
  });

// ── start ──
program
  .command("start")
  .description("Start the OpenSkelo runtime server")
  .option("-p, --port <port>", "Server port", "4040")
  .option("--no-dashboard", "API only, no dashboard UI")
  .action(async (opts) => {
    await startServer({
      port: parseInt(opts.port),
      dashboard: opts.dashboard,
    });
  });

// legacy task commands removed

// ── kill ──
program
  .command("kill")
  .description("Emergency stop: kill all running DAG pipelines")
  .option("--api <url>", "API base URL", process.env.OPENSKELO_API ?? "http://localhost:4040")
  .action(async (opts) => {
    await killCommand(opts);
  });

// ── status ──
program
  .command("status")
  .description("Show pipeline health, agents, and queue depth")
  .action(async () => {
    await statusCommand();
  });

// ── run (DAG runtime) ──
const run = program
  .command("run")
  .description("Operate DAG runs via /api/dag/* (canonical runtime)");

runCommands(run);

// ── autopilot ──
program
  .command("autopilot <goal>")
  .description("Generate a DAG from a natural-language goal and execute it")
  .option("--api <url>", "API base URL", process.env.OPENSKELO_API ?? "http://localhost:4040")
  .option("--provider <nameOrType>", "Provider override")
  .option("--dry-run", "Print planned DAG JSON and exit", false)
  .action(async (goal, opts) => {
    await autopilotCommand(goal, opts);
  });

// ── watch ──
program
  .command("watch [runId]")
  .description("Graphically watch DAG progress in terminal (no dashboard UI)")
  .option("--interval-ms <ms>", "Poll interval", "900")
  .option("--no-follow", "Do not follow iterated child runs")
  .option("--api <url>", "API base URL", process.env.OPENSKELO_API ?? "http://localhost:4040")
  .action(async (runId, opts) => {
    await watchCommand(runId, opts);
  });

// ── validate ──
program
  .command("validate")
  .description("Validate skelo.yaml configuration")
  .action(async () => {
    // TODO: implement
    console.log(chalk.yellow("validate not yet implemented"));
  });

// ── agents ──
program
  .command("agents")
  .description("List registered agents with current status")
  .action(async () => {
    // TODO: implement
    console.log(chalk.yellow("agents not yet implemented"));
  });

// ── gates ──
program
  .command("gates")
  .description("List all pipeline gates with pass/fail stats")
  .action(async () => {
    // TODO: implement
    console.log(chalk.yellow("gates not yet implemented"));
  });

// ── logs ──
program
  .command("logs")
  .description("Stream audit log")
  .option("--task <taskId>", "Filter to a specific task")
  .action(async (opts) => {
    // TODO: implement
    console.log(chalk.yellow("logs not yet implemented"));
  });

program.parse();
