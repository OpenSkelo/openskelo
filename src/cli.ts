import { Command } from "commander";
import chalk from "chalk";
import { initProject } from "./commands/init.js";
import { startServer } from "./commands/start.js";
import { statusCommand } from "./commands/status.js";
import { runCommands } from "./commands/run.js";
import { autopilotCommand } from "./commands/autopilot.js";
import { killCommand } from "./commands/kill.js";
import { watchCommand } from "./commands/watch.js";
import { validateCommand } from "./commands/validate.js";
import { explainCommand } from "./commands/explain.js";
import { newCommand } from "./commands/new.js";
import { authCommands } from "./commands/auth.js";
import { onboardCommand } from "./commands/onboard.js";
import { chatCommand } from "./commands/chat.js";
import { askCommand } from "./commands/ask.js";

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

// ── onboard ──
onboardCommand(program);

// ── init ──
program
  .command("init [name]")
  .description("Interactive first-run setup for an OpenSkelo agent project")
  .option("-t, --template <template>", "Use preset legacy DAG template (coding|research|content|custom) or 'agent'", "agent")
  .action(async (name, opts) => {
    await initProject(name, opts.template, { interactive: true });
  });

// ── new ──
program
  .command("new <name>")
  .description("Scaffold a new DAG in pipelines/")
  .option("--pattern <pattern>", "linear|fanout|review-loop", "linear")
  .option("--blocks <csv>", "Comma-separated block ids", "plan,build,test")
  .action(async (name, opts) => {
    await newCommand(name, opts);
  });

// ── chat ──
program
  .command("chat <agentId>")
  .description("Interactive chat with an agent")
  .action(async (agentId) => {
    await chatCommand(agentId);
  });

program
  .command("ask <agentId> <prompt>")
  .description("Run a single non-interactive agent turn")
  .option("--json", "Print structured JSON output", false)
  .action(async (agentId, prompt, opts) => {
    await askCommand(agentId, prompt, opts);
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
  .command("validate [target]")
  .description("Validate agent project (default) or a DAG YAML file")
  .action(async (target) => {
    await validateCommand(target);
  });

// ── explain ──
program
  .command("explain <dagFile>")
  .description("Dry-run explain DAG execution order, wiring, and required inputs")
  .action(async (dagFile) => {
    await explainCommand(dagFile);
  });

// ── agents ──
program
  .command("agents")
  .description("List registered agents with current status")
  .action(async () => {
    console.log(chalk.yellow("agents command is coming in v0.2. Use 'skelo status' for active config summary."));
  });

// ── gates ──
program
  .command("gates")
  .description("List all pipeline gates with pass/fail stats")
  .action(async () => {
    console.log(chalk.yellow("gates command is coming in v0.2. Use 'skelo explain <dagFile>' to inspect configured gates now."));
  });

// ── logs ──
program
  .command("logs")
  .description("Stream audit log")
  .option("--task <taskId>", "Filter to a specific task")
  .action(async () => {
    console.log(chalk.yellow("logs command is coming in v0.2. Use /dag event log or /api/dag/runs/<id>/events for now."));
  });

authCommands(program);

program.parse();
