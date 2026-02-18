import chalk from "chalk";
import { loadConfig } from "../core/config.js";
import { createDB, getDB } from "../core/db.js";

export async function statusCommand() {
  const config = loadConfig();
  createDB();
  const db = getDB();

  const rows = db.prepare("SELECT status, COUNT(*) as count FROM dag_runs GROUP BY status").all() as Array<{ status: string; count: number }>;
  const runCounts = Object.fromEntries(rows.map((r) => [r.status, r.count]));
  const total = Object.values(runCounts).reduce((a, b) => a + Number(b), 0);

  console.log(chalk.hex("#f97316")(`\n🦴 ${config.name}\n`));

  console.log(chalk.bold("  DAG Runtime:"));
  console.log(chalk.dim("    Canonical API:") + " /api/dag/*");
  console.log(chalk.dim("    Dashboard:") + " /dag");

  console.log(chalk.bold("\n  Runs:") + chalk.dim(` (${total} total)`));
  const statusColors: Record<string, string> = {
    pending: "#888888",
    running: "#3b82f6",
    paused_approval: "#f59e0b",
    completed: "#22c55e",
    failed: "#ef4444",
    cancelled: "#6b7280",
    iterated: "#a855f7",
  };
  for (const [status, count] of Object.entries(runCounts)) {
    const color = statusColors[status] ?? "#888888";
    const bar = chalk.hex(color)("█".repeat(Math.min(Number(count), 30)));
    console.log(`    ${chalk.hex(color)(status.padEnd(16))} ${bar} ${count}`);
  }

  console.log(chalk.bold("\n  Agents:"));
  for (const [id, agent] of Object.entries(config.agents)) {
    const icon = agent.role === "worker" ? "🔧" : agent.role === "reviewer" ? "🔍" : "🧠";
    console.log(chalk.dim(`    ${icon} ${id}`) + ` (${agent.role}) → ${agent.model}`);
  }

  console.log();
}
