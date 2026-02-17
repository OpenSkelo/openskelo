import chalk from "chalk";
import { loadConfig } from "../core/config.js";
import { createDB } from "../core/db.js";
import { createTaskEngine } from "../core/task-engine.js";

export async function statusCommand() {
  const config = loadConfig();
  createDB();
  const engine = createTaskEngine(config.pipelines);

  const taskCounts = engine.counts();
  const total = Object.values(taskCounts).reduce((a, b) => a + b, 0);

  console.log(chalk.hex("#f97316")(`\n🦴 ${config.name}\n`));

  // Pipeline status
  console.log(chalk.bold("  Pipelines:"));
  for (const [id, pipeline] of Object.entries(config.pipelines)) {
    const stageNames = pipeline.stages.map((s) => s.name).join(" → ");
    console.log(chalk.dim(`    ${id}: `) + stageNames);
  }

  // Task counts
  console.log(chalk.bold("\n  Tasks:") + chalk.dim(` (${total} total)`));
  const statusColors: Record<string, string> = {
    PENDING: "#888888",
    IN_PROGRESS: "#3b82f6",
    REVIEW: "#a855f7",
    DONE: "#22c55e",
    BLOCKED: "#ef4444",
  };
  for (const [status, count] of Object.entries(taskCounts)) {
    const color = statusColors[status] ?? "#888888";
    const bar = chalk.hex(color)("█".repeat(Math.min(count, 30)));
    console.log(`    ${chalk.hex(color)(status.padEnd(12))} ${bar} ${count}`);
  }

  // Agents
  console.log(chalk.bold("\n  Agents:"));
  for (const [id, agent] of Object.entries(config.agents)) {
    const icon = agent.role === "worker" ? "🔧" : agent.role === "reviewer" ? "🔍" : "🧠";
    console.log(chalk.dim(`    ${icon} ${id}`) + ` (${agent.role}) → ${agent.model}`);
  }

  // Gates
  console.log(chalk.bold(`\n  Gates: ${config.gates.length} active`));
  for (const gate of config.gates) {
    const trigger = [gate.on.from, gate.on.to].filter(Boolean).join(" → ");
    console.log(chalk.dim(`    🚧 ${gate.name}`) + chalk.dim(` (${trigger})`));
  }

  console.log();
}
