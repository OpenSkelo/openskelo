import chalk from "chalk";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { loadDagFromFile, requiredContextInputs } from "./dag-cli-utils.js";

export async function validateCommand(dagFile: string): Promise<void> {
  try {
    const { dag, path } = loadDagFromFile(dagFile);
    console.log(chalk.green("✓ YAML/DAG schema valid"));
    console.log(chalk.green(`✓ ${dag.blocks.length} blocks parsed`));
    console.log(chalk.green(`✓ ${dag.edges.length} edges validated`));

    const projectRoot = dirname(path);
    for (const block of dag.blocks) {
      if (block.block_dir) {
        const fullPath = resolve(projectRoot, block.block_dir);
        if (!existsSync(fullPath)) {
          throw new Error(`Block "${block.id}": block_dir not found: ${block.block_dir}`);
        }
      }
    }

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

    console.log(chalk.dim(`file: ${path}`));
  } catch (err) {
    console.error(chalk.red(`✗ ${String((err as Error).message ?? err)}`));
    process.exit(1);
  }
}
