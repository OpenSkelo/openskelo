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
  if (status === "iterated") return "🔁";
  if (status === "ready") return "🟡";
  if (status === "pending") return "⚪";
  return "•";
}

function fmtSeconds(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return m > 0 ? `${m}m ${r}s` : `${r}s`;
}

function progressBar(done: number, total: number, width = 18): string {
  const ratio = total > 0 ? Math.max(0, Math.min(1, done / total)) : 0;
  const filled = Math.round(ratio * width);
  return `[${"█".repeat(filled)}${"·".repeat(width - filled)}] ${Math.round(ratio * 100)}%`;
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

export async function watchCommand(runIdArg: string | undefined, opts: { api?: string; intervalMs?: string | number; follow?: boolean }): Promise<void> {
  const api = opts.api ?? DEFAULT_API;
  const intervalMs = Math.max(250, Number(opts.intervalMs ?? 900));
  const follow = opts.follow !== false;

  let runId = runIdArg && runIdArg.trim().length > 0 ? runIdArg : await resolveRunId(api);
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
    const createdAtMs = new Date(String(run.created_at ?? 0)).getTime();
    const elapsedText = createdAtMs ? fmtSeconds(Date.now() - createdAtMs) : "—";

    const blockRows = Object.entries(blocks).map(([id, b]) => {
      const st = String(b.status ?? "unknown");
      const attempt = Number((b.retry_state as Record<string, unknown> | undefined)?.attempt ?? 0);
      const gateFail = ((b.post_gate_results as Array<Record<string, unknown>> | undefined) ?? []).find((g) => g.passed === false)
        ?? ((b.pre_gate_results as Array<Record<string, unknown>> | undefined) ?? []).find((g) => g.passed === false);
      const startedAtMs = new Date(String(b.started_at ?? b.startedAt ?? 0)).getTime();
      const runtime = startedAtMs ? fmtSeconds(Date.now() - startedAtMs) : "";
      return { id, st, attempt, gateFail: gateFail ? String(gateFail.name ?? "") : "", runtime };
    });

    const total = blockRows.length;
    const doneCount = blockRows.filter((r) => r.st === "completed").length;
    const running = blockRows.find((r) => r.st === "running");
    const failed = blockRows.filter((r) => r.st === "failed").length;

    const runCtx = (run.context as Record<string, unknown> | undefined) ?? {};
    const cycle = String((runCtx.__shared_memory as Record<string, unknown> | undefined)?.cycle ?? "1");
    const maxCycles = String((runCtx.__shared_memory as Record<string, unknown> | undefined)?.max_cycles ?? "?");
    const root = String(runCtx.__iteration_root_run_id ?? run.id ?? "");
    const parent = String(runCtx.__iteration_parent_run_id ?? "");
    const latest = String(runCtx.__latest_iterated_run_id ?? "");

    process.stdout.write("\x1Bc");
    console.log(chalk.bold(`🦴 OpenSkelo Watch — ${runId}`));
    console.log(`${statusIcon(runStatus)} ${chalk.cyan(runStatus)}  ${chalk.dim(String(run.dag_name ?? ""))}`);
    console.log(`${progressBar(doneCount, total)}  ${chalk.dim(`elapsed ${elapsedText}`)}`);
    if (running) console.log(chalk.yellow(`active: ${running.id} (${running.runtime || "—"})`));
    if (failed > 0) console.log(chalk.red(`failed blocks: ${failed}`));
    console.log(chalk.dim(`cycle: ${cycle}/${maxCycles}  root:${root.slice(0, 10) || "—"}${parent ? `  parent:${parent.slice(0, 10)}` : ""}${latest ? `  latest:${latest.slice(0, 10)}` : ""}`));

    const approval = (data.approval as Record<string, unknown> | undefined);
    if (approval && String(approval.status ?? "") === "pending") {
      console.log(chalk.yellow(`approval pending on block: ${String(approval.block_id ?? "unknown")}`));
    }

    console.log();

    for (const row of blockRows) {
      const gateNote = row.gateFail ? chalk.red(` gate:${row.gateFail}`) : "";
      const retryNote = row.attempt > 1 ? chalk.yellow(` attempt:${row.attempt}`) : "";
      const runtimeNote = row.runtime && row.st === "running" ? chalk.yellow(` runtime:${row.runtime}`) : "";
      console.log(`${statusIcon(row.st)} ${chalk.bold(row.id)} ${chalk.dim(row.st)}${retryNote}${runtimeNote}${gateNote}`);
    }

    const latestIterated = latest;
    const done = ["completed", "failed", "cancelled", "iterated"].includes(runStatus);
    if (done) {
      if (follow && latestIterated && latestIterated !== runId) {
        console.log();
        console.log(chalk.cyan(`↪ following iterated run: ${latestIterated}`));
        runId = latestIterated;
        await sleep(150);
        continue;
      }
      console.log();
      console.log(chalk.bold(done && runStatus === "completed" ? "✅ Run complete" : `🧾 Terminal status: ${runStatus}`));
      break;
    }

    await sleep(intervalMs);
  }
}
