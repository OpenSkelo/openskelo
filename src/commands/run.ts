import { Command } from "commander";
import chalk from "chalk";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function statusIcon(status: string): string {
  if (status === "completed") return "✅";
  if (status === "failed") return "❌";
  if (status === "running") return "🔄";
  if (status === "paused_approval") return "⏸️";
  if (status === "cancelled") return "🛑";
  if (status === "ready") return "🟡";
  if (status === "pending") return "⚪";
  return "•";
}

const DEFAULT_API = process.env.OPENSKELO_API ?? "http://localhost:4040";

export function runCommands(parent: Command): void {
  parent
    .command("start")
    .description("Start a DAG run")
    .requiredOption("--example <file>", "Example DAG yaml filename from examples/")
    .option("--provider <nameOrType>", "Provider override")
    .option("--context-json <json>", "JSON object for run context", "{}")
    .option("--api <url>", "API base URL", DEFAULT_API)
    .action(async (opts) => {
      let context: Record<string, unknown> = {};
      try {
        context = JSON.parse(opts.contextJson);
      } catch {
        console.error(chalk.red("✗ --context-json must be valid JSON"));
        process.exit(1);
      }

      const body: Record<string, unknown> = {
        example: opts.example,
        context,
      };
      if (opts.provider) body.provider = opts.provider;

      const res = await fetch(`${opts.api}/api/dag/run`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });

      const data = (await res.json()) as Record<string, unknown>;
      if (!res.ok) {
        console.error(chalk.red(`✗ ${(data.error as string) ?? `HTTP ${res.status}`}`));
        process.exit(1);
      }

      console.log(chalk.green(`✓ Run started: ${String(data.run_id ?? "unknown")}`));
      if (data.status_url) console.log(chalk.dim(`  status: ${String(data.status_url)}`));
      if (data.sse_url) console.log(chalk.dim(`  events: ${String(data.sse_url)}`));
    });

  parent
    .command("list")
    .description("List DAG runs")
    .option("--api <url>", "API base URL", DEFAULT_API)
    .action(async (opts) => {
      const res = await fetch(`${opts.api}/api/dag/runs`);
      const data = (await res.json()) as { runs?: Array<Record<string, unknown>>; error?: string };
      if (!res.ok) {
        console.error(chalk.red(`✗ ${data.error ?? `HTTP ${res.status}`}`));
        process.exit(1);
      }
      const runs = data.runs ?? [];
      if (runs.length === 0) {
        console.log(chalk.dim("No DAG runs found."));
        return;
      }
      for (const r of runs) {
        console.log(`${chalk.bold(String(r.id))} ${chalk.cyan(String(r.status))} ${chalk.dim(String(r.dag_name ?? ""))}`);
      }
    });

  parent
    .command("status <runId>")
    .description("Show DAG run status")
    .option("--api <url>", "API base URL", DEFAULT_API)
    .action(async (runId, opts) => {
      const res = await fetch(`${opts.api}/api/dag/runs/${encodeURIComponent(runId)}`);
      const data = (await res.json()) as Record<string, unknown>;
      if (!res.ok) {
        console.error(chalk.red(`✗ ${String(data.error ?? `HTTP ${res.status}`)}`));
        process.exit(1);
      }
      const run = (data.run as Record<string, unknown>) ?? {};
      console.log(chalk.bold(`${String(run.id)} ${chalk.cyan(String(run.status))}`));
      console.log(chalk.dim(`dag: ${String(run.dag_name ?? "")}`));
      if (data.approval) {
        const ap = data.approval as Record<string, unknown>;
        console.log(chalk.yellow(`approval pending on block ${String(ap.block_id ?? "unknown")}`));
      }
    });

  parent
    .command("approve <runId>")
    .description("Approve pending human gate for a run")
    .option("--notes <notes>", "Approval notes", "Approved via CLI")
    .option("--api <url>", "API base URL", DEFAULT_API)
    .action(async (runId, opts) => {
      const res = await fetch(`${opts.api}/api/dag/runs/${encodeURIComponent(runId)}/approvals`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "approve", notes: opts.notes }),
      });
      const data = (await res.json()) as Record<string, unknown>;
      if (!res.ok) {
        console.error(chalk.red(`✗ ${String(data.error ?? `HTTP ${res.status}`)}`));
        process.exit(1);
      }
      console.log(chalk.green(`✓ Approved ${runId}`));
    });

  parent
    .command("reject <runId>")
    .description("Reject pending human gate for a run")
    .requiredOption("--feedback <text>", "Rejection feedback")
    .option("--restart-mode <mode>", "retry|iterate", "iterate")
    .option("--api <url>", "API base URL", DEFAULT_API)
    .action(async (runId, opts) => {
      const res = await fetch(`${opts.api}/api/dag/runs/${encodeURIComponent(runId)}/approvals`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "reject", feedback: opts.feedback, restart_mode: opts.restartMode }),
      });
      const data = (await res.json()) as Record<string, unknown>;
      if (!res.ok) {
        console.error(chalk.red(`✗ ${String(data.error ?? `HTTP ${res.status}`)}`));
        process.exit(1);
      }
      console.log(chalk.green(`✓ Rejected ${runId}`));
      if (data.next_run_id) console.log(chalk.dim(`  next run: ${String(data.next_run_id)}`));
    });

  parent
    .command("watch <runId>")
    .description("Watch DAG run progress in terminal (shareable view)")
    .option("--interval-ms <ms>", "Poll interval", "900")
    .option("--api <url>", "API base URL", DEFAULT_API)
    .action(async (runId, opts) => {
      const intervalMs = Math.max(250, Number(opts.intervalMs ?? 900));

      while (true) {
        const res = await fetch(`${opts.api}/api/dag/runs/${encodeURIComponent(runId)}`);
        const data = (await res.json()) as Record<string, unknown>;
        if (!res.ok) {
          console.error(chalk.red(`✗ ${String(data.error ?? `HTTP ${res.status}`)}`));
          process.exit(1);
        }

        const run = (data.run as Record<string, unknown>) ?? {};
        const runStatus = String(run.status ?? "unknown");
        const blocks = (run.blocks as Record<string, Record<string, unknown>>) ?? {};

        process.stdout.write("\x1Bc");
        console.log(chalk.bold(`🦴 OpenSkelo Watch — ${runId}`));
        console.log(`${statusIcon(runStatus)} ${chalk.cyan(runStatus)}  ${chalk.dim(String(run.dag_name ?? ""))}`);
        console.log();

        const blockRows = Object.entries(blocks).map(([id, b]) => {
          const st = String(b.status ?? "unknown");
          const attempt = Number((b.retry_state as Record<string, unknown> | undefined)?.attempt ?? 0);
          const gateFail = ((b.post_gate_results as Array<Record<string, unknown>> | undefined) ?? []).find((g) => g.passed === false)
            ?? ((b.pre_gate_results as Array<Record<string, unknown>> | undefined) ?? []).find((g) => g.passed === false);
          return { id, st, attempt, gateFail: gateFail ? String(gateFail.name ?? "") : "" };
        });

        for (const row of blockRows) {
          const gateNote = row.gateFail ? chalk.red(` gate:${row.gateFail}`) : "";
          const retryNote = row.attempt > 1 ? chalk.yellow(` attempt:${row.attempt}`) : "";
          console.log(`${statusIcon(row.st)} ${chalk.bold(row.id)} ${chalk.dim(row.st)}${retryNote}${gateNote}`);
        }

        const done = ["completed", "failed", "cancelled", "iterated"].includes(runStatus);
        if (done) {
          console.log();
          console.log(chalk.bold(done && runStatus === "completed" ? "✅ Run complete" : `🧾 Terminal status: ${runStatus}`));
          break;
        }

        await sleep(intervalMs);
      }
    });

  parent
    .command("stop <runId>")
    .description("Stop a DAG run")
    .option("--api <url>", "API base URL", DEFAULT_API)
    .action(async (runId, opts) => {
      const res = await fetch(`${opts.api}/api/dag/runs/${encodeURIComponent(runId)}/stop`, { method: "POST" });
      const data = (await res.json()) as Record<string, unknown>;
      if (!res.ok) {
        console.error(chalk.red(`✗ ${String(data.error ?? `HTTP ${res.status}`)}`));
        process.exit(1);
      }
      console.log(chalk.green(`✓ Stopped ${runId}`));
    });
}
