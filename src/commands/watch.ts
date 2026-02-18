import chalk from "chalk";

const DEFAULT_API = process.env.OPENSKELO_API ?? "http://localhost:4040";

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

async function resolveRunId(api: string): Promise<string | null> {
  const res = await fetch(`${api}/api/dag/runs?limit=50`);
  if (!res.ok) return null;
  const data = (await res.json()) as { runs?: Array<Record<string, unknown>> };
  const runs = data.runs ?? [];
  if (!runs.length) return null;

  const active = runs.find((r) => {
    const st = String(r.status ?? "");
    return st === "running" || st === "paused_approval" || st === "pending" || st === "ready";
  });
  if (active?.id) return String(active.id);

  return String(runs[0]?.id ?? "");
}

export async function watchCommand(runIdArg: string | undefined, opts: { api?: string; intervalMs?: string | number }): Promise<void> {
  const api = opts.api ?? DEFAULT_API;
  const intervalMs = Math.max(250, Number(opts.intervalMs ?? 900));

  const runId = runIdArg && runIdArg.trim().length > 0 ? runIdArg : await resolveRunId(api);
  if (!runId) {
    console.error(chalk.red("✗ No DAG runs found to watch."));
    process.exit(1);
  }

  while (true) {
    const res = await fetch(`${api}/api/dag/runs/${encodeURIComponent(runId)}`);
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
}
