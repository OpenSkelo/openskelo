import { Command } from "commander";
import chalk from "chalk";
import { readFileSync } from "fs";
import { watchCommand } from "./watch.js";
import { loadConfig } from "../core/config.js";
import { contextEntryInputs, loadDagFromFile, missingRequiredInputs, parseInputPairs, requiredContextInputs, resolveDagPath, suggestClosestInput } from "./dag-cli-utils.js";

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
    .argument("[dagFile]", "DAG yaml file (path, pipelines/name, examples/name)")
    .option("--input <key=value>", "Named context input (repeatable)", collect, [])
    .option("--watch", "Watch run live in terminal", false)
    .option("--provider <nameOrType>", "Provider override")
    .option("--api <url>", "API base URL", DEFAULT_API)
    .description("Run a DAG directly: skelo run my-pipeline.yaml --input prompt=\"Build login\" --watch")
    .action(async (dagFile, opts) => {
      if (!dagFile) {
        console.log(chalk.dim("Tip: skelo run <dag-file> --input prompt=\"...\" --watch"));
        return;
      }
      await runDagFile(dagFile, opts);
    });

  parent
    .command("start")
    .description("Start a DAG run (legacy flags supported)")
    .option("--example <file>", "DAG yaml filename from examples/ or pipelines/")
    .option("--pipeline <file>", "Alias for --example")
    .option("--dag-file <file>", "Run DAG YAML by path")
    .option("--input <key=value>", "Named context input (repeatable)", collect, [])
    .option("--watch", "Watch run live in terminal", false)
    .option("--provider <nameOrType>", "Provider override")
    .option("--context-json <json>", "JSON object for run context", "{}")
    .option("--api <url>", "API base URL", DEFAULT_API)
    .action(async (opts) => {
      const dagFile = (opts.dagFile as string | undefined) ?? (opts.pipeline as string | undefined) ?? (opts.example as string | undefined);
      if (!dagFile) {
        console.error(chalk.red("✗ Provide --dag-file (or --pipeline/--example)"));
        process.exit(1);
      }
      await runDagFile(dagFile, opts);
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
    .option("--no-follow", "Do not follow iterated child runs")
    .option("--api <url>", "API base URL", DEFAULT_API)
    .action(async (initialRunId, opts) => {
      const intervalMs = Math.max(250, Number(opts.intervalMs ?? 900));
      const follow = opts.follow !== false;
      let runId = initialRunId;

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

        const latestIterated = String((run.context as Record<string, unknown> | undefined)?.__latest_iterated_run_id ?? "");
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

  parent
    .command("kill")
    .description("Emergency stop: kill all running DAG pipelines")
    .option("--api <url>", "API base URL", DEFAULT_API)
    .action(async (opts) => {
      const res = await fetch(`${opts.api}/api/dag/runs/stop-all`, { method: "POST" });
      const data = (await res.json()) as Record<string, unknown>;
      if (!res.ok) {
        console.error(chalk.red(`✗ ${String(data.error ?? `HTTP ${res.status}`)}`));
        process.exit(1);
      }
      const stopped = Number(data.stopped ?? 0);
      console.log(chalk.green(`✓ Emergency stop complete. Stopped ${stopped} run${stopped === 1 ? "" : "s"}.`));
    });
}

async function runDagFile(dagFile: string, opts: Record<string, unknown>): Promise<void> {
  const api = String(opts.api ?? DEFAULT_API);
  const inputContext = parseInputPairs(opts.input as string[] | undefined);

  let context: Record<string, unknown> = {};
  try {
    context = JSON.parse(String(opts.contextJson ?? "{}")) as Record<string, unknown>;
  } catch {
    console.error(chalk.red("✗ --context-json must be valid JSON"));
    process.exit(1);
  }

  context = { ...context, ...inputContext };

  const loaded = loadDagFromFile(dagFile);
  const { dag } = loaded;
  const entryInputs = contextEntryInputs(dag);
  const entryNames = new Set(entryInputs.map((i) => i.name));

  const unknownInputs = Object.keys(inputContext).filter((k) => !entryNames.has(k));
  if (unknownInputs.length > 0) {
    console.error(chalk.red("✗ Unknown --input key(s):"));
    for (const key of unknownInputs) {
      const hint = suggestClosestInput(key, [...entryNames]);
      console.error(`  - ${key}${hint ? ` (did you mean '${hint}'?)` : ""}`);
    }
    if (entryInputs.length > 0) {
      console.error(chalk.dim("Valid entry inputs:"));
      for (const i of entryInputs) {
        const req = i.required ? "required" : "optional";
        console.error(chalk.dim(`  - ${i.name} (${i.type}, ${req})${i.description ? ` — ${i.description}` : ""}`));
      }
    }
    process.exit(1);
  }

  const missing = missingRequiredInputs(requiredContextInputs(dag), context);
  if (missing.length > 0) {
    console.error(chalk.red("✗ Missing required input(s):"));
    for (const m of missing) {
      console.error(`  - block entry port '${m.name}' (type: ${m.type})${m.description ? ` — ${m.description}` : ""}`);
      const valHint = m.type === "json" ? `'{}'` : (m.type === "number" ? "123" : (m.type === "boolean" ? "true" : "\"value\""));
      console.error(chalk.dim(`    fix: --input ${m.name}=${valHint}`));
    }
    process.exit(1);
  }

  const resolvedPath = resolveDagPath(dagFile);
  const body: Record<string, unknown> = {
    dag: loaded.raw,
    context,
  };
  if (opts.provider) body.provider = String(opts.provider);

  let res: Response;
  try {
    res = await fetch(`${api}/api/dag/run`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch (err) {
    console.error(chalk.red(`✗ Failed to reach API at ${api}: ${String((err as Error).message ?? err)}`));
    process.exit(1);
    return;
  }

  const data = (await res.json()) as Record<string, unknown>;
  if (!res.ok) {
    console.error(chalk.red(`✗ ${(data.error as string) ?? `HTTP ${res.status}`}`));
    process.exit(1);
  }

  const runId = String(data.run_id ?? "unknown");
  console.log(chalk.green(`✓ Run started: ${runId}`));
  console.log(chalk.dim(`  dag: ${dag.name}`));
  console.log(chalk.dim(`  file: ${resolvedPath}`));
  if (data.status_url) console.log(chalk.dim(`  status: ${String(data.status_url)}`));
  if (data.sse_url) console.log(chalk.dim(`  events: ${String(data.sse_url)}`));

  const routingLines = getBlockRoutingSummary(dag);
  if (routingLines.length > 0) {
    console.log(chalk.dim("  routing:"));
    for (const line of routingLines.slice(0, 8)) console.log(chalk.dim(`    - ${line}`));
    if (routingLines.length > 8) console.log(chalk.dim(`    - ... ${routingLines.length - 8} more blocks`));
  }

  if (opts.watch) {
    await watchCommand(runId, { api });
  }
}

function getBlockRoutingSummary(dag: { blocks: Array<{ id: string; agent?: { specific?: string; role?: string; capability?: string } }> }): string[] {
  let cfg: ReturnType<typeof loadConfig> | null = null;
  try {
    cfg = loadConfig();
  } catch {
    cfg = null;
  }

  const lines: string[] = [];
  for (const b of dag.blocks) {
    const a = b.agent ?? {};
    if (!cfg) {
      lines.push(`${b.id}: selector=${a.specific ? `specific:${a.specific}` : (a.role ? `role:${a.role}` : (a.capability ? `capability:${a.capability}` : "default"))}`);
      continue;
    }

    const agents = cfg.agents;
    let selectedId: string | null = null;
    let reason = "";

    if (a.specific && agents[a.specific]) {
      selectedId = a.specific;
      reason = "specific";
    } else if (a.role) {
      selectedId = Object.keys(agents).find((id) => agents[id]?.role === a.role) ?? null;
      if (selectedId) reason = `role:${a.role}`;
    }
    if (!selectedId && a.capability) {
      selectedId = Object.keys(agents).find((id) => Array.isArray(agents[id]?.capabilities) && agents[id].capabilities.includes(a.capability!)) ?? null;
      if (selectedId) reason = `capability:${a.capability}`;
    }
    if (!selectedId) {
      selectedId = Object.keys(agents)[0] ?? null;
      if (selectedId) reason = "default:first-agent";
    }

    if (!selectedId || !agents[selectedId]) {
      lines.push(`${b.id}: unresolved selector`);
      continue;
    }
    const agent = agents[selectedId];
    lines.push(`${b.id}: ${selectedId} via ${reason} → provider=${agent.provider}, model=${agent.model}`);
  }
  return lines;
}

function collect(value: string, prev: string[]): string[] {
  prev.push(value);
  return prev;
}
