import chalk from "chalk";
import { planDagFromGoal } from "../core/autopilot.js";

const DEFAULT_API = process.env.OPENSKELO_API ?? "http://localhost:4040";

export async function autopilotCommand(goal: string, opts: { api?: string; provider?: string; dryRun?: boolean }) {
  const api = opts.api ?? DEFAULT_API;
  const dag = planDagFromGoal(goal);

  if (opts.dryRun) {
    console.log(JSON.stringify(dag, null, 2));
    return;
  }

  const body: Record<string, unknown> = {
    dag,
    context: { prompt: goal, goal },
  };
  if (opts.provider) body.provider = opts.provider;

  const res = await fetch(`${api}/api/dag/run`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

  const data = (await res.json()) as Record<string, unknown>;
  if (!res.ok) {
    console.error(chalk.red(`✗ ${String(data.error ?? `HTTP ${res.status}`)}`));
    process.exit(1);
  }

  console.log(chalk.green(`✓ Autopilot run started: ${String(data.run_id ?? "unknown")}`));
  if (data.sse_url) console.log(chalk.dim(`  events: ${String(data.sse_url)}`));
}
