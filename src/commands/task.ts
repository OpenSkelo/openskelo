import { Command } from "commander";
import chalk from "chalk";
import { loadConfig } from "../core/config.js";
import { createDB } from "../core/db.js";
import { createTaskEngine } from "../core/task-engine.js";
import { createGateEngine } from "../core/gate-engine.js";

export function taskCommands(parent: Command) {
  parent
    .command("create")
    .description("Create a new task")
    .requiredOption("--pipeline <pipeline>", "Pipeline type")
    .requiredOption("--title <title>", "Task title")
    .option("--assign <agent>", "Assign to agent")
    .option("--priority <priority>", "Priority (P0-P3)", "P2")
    .option("--description <desc>", "Task description")
    .action(async (opts) => {
      const config = loadConfig();
      createDB();
      const engine = createTaskEngine(config.pipelines);

      try {
        const task = engine.create({
          pipeline: opts.pipeline,
          title: opts.title,
          assigned: opts.assign ?? "",
          priority: opts.priority,
          description: opts.description ?? "",
        });
        console.log(chalk.green(`✓ ${task.id} created → ${task.status}`));
        if (task.assigned) {
          console.log(chalk.dim(`  Assigned to: ${task.assigned}`));
        }
      } catch (err) {
        console.error(chalk.red(`✗ ${(err as Error).message}`));
        process.exit(1);
      }
    });

  parent
    .command("list")
    .description("List all tasks")
    .option("--status <status>", "Filter by status")
    .option("--pipeline <pipeline>", "Filter by pipeline")
    .action(async (opts) => {
      const config = loadConfig();
      createDB();
      const engine = createTaskEngine(config.pipelines);
      const tasks = engine.list({ status: opts.status, pipeline: opts.pipeline });

      if (tasks.length === 0) {
        console.log(chalk.dim("No tasks found."));
        return;
      }

      const statusColors: Record<string, string> = {
        PENDING: "#888888",
        IN_PROGRESS: "#3b82f6",
        REVIEW: "#a855f7",
        DONE: "#22c55e",
        BLOCKED: "#ef4444",
        ARCHIVED: "#555555",
      };

      for (const task of tasks) {
        const color = statusColors[task.status] ?? "#888888";
        const status = chalk.hex(color)(`[${task.status}]`);
        const bounce = task.bounce_count > 0 ? chalk.yellow(` ↩${task.bounce_count}`) : "";
        console.log(`${chalk.bold(task.id)} ${status} ${task.title}${bounce}`);
        if (task.assigned) {
          console.log(chalk.dim(`  → ${task.assigned}`));
        }
      }
    });

  parent
    .command("show <taskId>")
    .description("Show task detail with history")
    .action(async (taskId) => {
      const config = loadConfig();
      const db = createDB();
      const engine = createTaskEngine(config.pipelines);

      const task = engine.getById(taskId);
      if (!task) {
        console.error(chalk.red(`✗ Task ${taskId} not found`));
        process.exit(1);
      }

      console.log(chalk.bold(`\n${task.id}: ${task.title}\n`));
      console.log(chalk.dim("  Pipeline:  ") + task.pipeline);
      console.log(chalk.dim("  Status:    ") + task.status);
      console.log(chalk.dim("  Assigned:  ") + (task.assigned || chalk.dim("unassigned")));
      console.log(chalk.dim("  Priority:  ") + task.priority);
      console.log(chalk.dim("  Bounces:   ") + task.bounce_count);
      console.log(chalk.dim("  Created:   ") + task.created_at);
      console.log(chalk.dim("  Updated:   ") + task.updated_at);

      if (task.notes) {
        console.log(chalk.dim("\n  Notes:"));
        console.log("  " + task.notes.replace(/\n/g, "\n  "));
      }

      // Show audit history
      const history = db.prepare(
        "SELECT * FROM audit_log WHERE task_id = ? ORDER BY created_at ASC"
      ).all(taskId) as Array<Record<string, unknown>>;

      if (history.length > 0) {
        console.log(chalk.dim("\n  History:"));
        for (const entry of history) {
          const from = entry.from_status ?? "—";
          const to = entry.to_status;
          const agent = entry.agent ?? "system";
          const time = (entry.created_at as string).split("T").pop()?.slice(0, 8) ?? "";
          console.log(chalk.dim(`  ${time} ${from} → ${to} (${agent})`));
        }
      }
      console.log();
    });

  parent
    .command("update <taskId>")
    .description("Update task status or fields")
    .option("--status <status>", "New status")
    .option("--assign <agent>", "Reassign")
    .option("--notes <notes>", "Update notes")
    .option("--agent <agent>", "Acting agent (for attribution)")
    .action(async (taskId, opts) => {
      const config = loadConfig();
      createDB();
      const taskEngine = createTaskEngine(config.pipelines);
      const gateEngine = createGateEngine(config.gates);

      const task = taskEngine.getById(taskId);
      if (!task) {
        console.error(chalk.red(`✗ Task ${taskId} not found`));
        process.exit(1);
      }

      if (opts.status) {
        // Run gates
        const results = gateEngine.evaluate(
          task,
          task.status,
          opts.status,
          { assigned: opts.assign, notes: opts.notes }
        );

        const failed = gateEngine.hasFailed(results);
        if (failed) {
          console.error(chalk.red(`✗ Gate '${failed.name}' failed: ${failed.reason}`));
          // Show all gate results
          for (const r of results) {
            const icon = r.result === "pass" ? chalk.green("✓") : chalk.red("✗");
            console.log(`  ${icon} ${r.name}${r.reason ? chalk.dim(` — ${r.reason}`) : ""}`);
          }
          process.exit(1);
        }

        try {
          const updated = taskEngine.transition(
            taskId,
            opts.status,
            { assigned: opts.assign, notes: opts.notes },
            opts.agent ?? "cli",
            results
          );
          console.log(chalk.green(`✓ ${taskId}: ${task.status} → ${updated.status}`));

          // Show gate results
          for (const r of results) {
            console.log(chalk.dim(`  ✓ ${r.name}`));
          }
        } catch (err) {
          console.error(chalk.red(`✗ ${(err as Error).message}`));
          process.exit(1);
        }
      }
    });
}
