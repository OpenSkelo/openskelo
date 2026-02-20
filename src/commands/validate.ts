import chalk from "chalk";
import { existsSync } from "node:fs";
import { dirname, resolve, join } from "node:path";
import { loadDagFromFile, requiredContextInputs } from "./dag-cli-utils.js";
import { loadAllAgents } from "../agents/loader.js";

export async function validateCommand(target?: string): Promise<void> {
  try {
    if (!target) {
      await validateAgentsProject();
      return;
    }
    await validateDagFile(target);
  } catch (err) {
    console.error(chalk.red(`✗ ${String((err as Error).message ?? err)}`));
    process.exit(1);
  }
}

async function validateAgentsProject(): Promise<void> {
  const agentsDir = join(process.cwd(), "agents");
  if (!existsSync(agentsDir)) {
    throw new Error("No target provided and no agents/ directory found. Use: skelo validate <dagFile> or run in an agent project.");
  }

  const loaded = await loadAllAgents(agentsDir);
  if (loaded.size === 0) {
    throw new Error("No valid agents found under agents/. Add agents/<id>/agent.yaml first.");
  }

  console.log(chalk.green(`✓ ${loaded.size} agent${loaded.size === 1 ? "" : "s"} validated`));
  for (const [id, agent] of loaded.entries()) {
    const markers: string[] = [];
    if (agent.hasRole) markers.push("role");
    if (agent.hasTask) markers.push("task");
    if (agent.hasRules) markers.push("rules");
    if (agent.hasSkills) markers.push("skills");
    if (agent.hasContext) markers.push("context");
    console.log(chalk.dim(`  - ${id} (${agent.runtime}, model=${agent.model.primary}) [${markers.join(", ") || "minimal"}]`));
  }
}

async function validateDagFile(dagFile: string): Promise<void> {
  const { dag, path: resolvedPath } = loadDagFromFile(dagFile);
  console.log(chalk.green("✓ YAML/DAG schema valid"));
  console.log(chalk.green(`✓ ${dag.blocks.length} blocks parsed`));
  console.log(chalk.green(`✓ ${dag.edges.length} edges validated`));

  const projectRoot = dirname(resolvedPath);
  for (const block of dag.blocks) {
    if (block.block_dir) {
      const fullPath = resolve(projectRoot, block.block_dir);
      if (!existsSync(fullPath)) {
        throw new Error(`Block "${block.id}": block_dir not found: ${block.block_dir}`);
      }
    }
  }

  console.log(chalk.green("✓ block_dir paths verified"));

  const required = requiredContextInputs(dag);
  if (required.length === 0) {
    console.log(chalk.green("✓ No required entry context inputs"));
  } else {
    console.log(chalk.cyan("Required context inputs:"));
    for (const r of required) {
      const desc = r.description ? ` — ${r.description}` : "";
      console.log(`  - ${chalk.bold(r.name)} (${r.type})${desc}`);
    }
  }

  console.log(chalk.dim(`file: ${resolvedPath}`));
}
