import chalk from "chalk";

const DEFAULT_API = process.env.OPENSKELO_API ?? "http://localhost:4040";

export async function killCommand(opts: { api?: string }): Promise<void> {
  const api = opts.api ?? DEFAULT_API;

  const res = await fetch(`${api}/api/dag/runs/stop-all`, {
    method: "POST",
  });

  const data = (await res.json()) as { ok?: boolean; stopped?: number; error?: string };
  if (!res.ok) {
    console.error(chalk.red(`✗ ${data.error ?? `HTTP ${res.status}`}`));
    process.exit(1);
  }

  const stopped = Number(data.stopped ?? 0);
  console.log(chalk.green(`✓ Emergency stop complete. Stopped ${stopped} run${stopped === 1 ? "" : "s"}.`));
}
