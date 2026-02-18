import { writeFileSync } from "fs";
import { resolve } from "path";
import chalk from "chalk";
import { ensurePipelinesDir, normalizeDagFilename } from "./dag-cli-utils.js";

type Pattern = "linear" | "fanout" | "review-loop";

export async function newCommand(name: string, opts: { pattern?: Pattern; blocks?: string }): Promise<void> {
  const pattern = (opts.pattern ?? "linear") as Pattern;
  const blockNames = (opts.blocks ?? "plan,build,test")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  if (blockNames.length < 2) {
    console.error(chalk.red("✗ --blocks must include at least 2 block ids"));
    process.exit(1);
  }

  const dag = buildPattern(name, pattern, blockNames);
  const dir = ensurePipelinesDir();
  const file = normalizeDagFilename(name);
  const outPath = resolve(dir, file);
  writeFileSync(outPath, dag, "utf-8");

  console.log(chalk.green(`✓ Created ${outPath}`));
  console.log(chalk.dim(`Run: skelo run ${outPath} --input prompt=\"Build X\" --watch`));
}

function buildPattern(name: string, pattern: Pattern, blocks: string[]): string {
  if (pattern === "fanout" && blocks.length < 3) {
    throw new Error("fanout pattern needs at least 3 blocks");
  }
  if (pattern === "review-loop" && blocks.length < 2) {
    throw new Error("review-loop pattern needs at least 2 blocks");
  }

  const edges: Array<{ from: string; output: string; to: string; input: string }> = [];

  if (pattern === "linear") {
    for (let i = 0; i < blocks.length - 1; i++) {
      edges.push({ from: blocks[i], output: "result", to: blocks[i + 1], input: "prompt" });
    }
  } else if (pattern === "fanout") {
    const root = blocks[0];
    const sinks = blocks.slice(1, -1);
    const join = blocks[blocks.length - 1];
    for (const s of sinks) edges.push({ from: root, output: "result", to: s, input: "prompt" });
    for (const s of sinks) edges.push({ from: s, output: "result", to: join, input: "prompt" });
  } else if (pattern === "review-loop") {
    const build = blocks[0];
    const review = blocks[1];
    edges.push({ from: build, output: "result", to: review, input: "prompt" });
  }

  const blockYaml = blocks
    .map((id, idx) => {
      const approval = pattern === "review-loop" && idx === 1
        ? "\n    approval:\n      required: true"
        : "";
      return `  - id: ${id}\n    name: ${id}\n    inputs:\n      prompt: { type: string, description: \"Input for ${id}\" }\n    outputs:\n      result: { type: string, description: \"Output from ${id}\" }\n    agent:\n      role: worker\n      capability: writing\n    pre_gates: []\n    post_gates: []\n    retry: { max_attempts: 1, backoff: linear, delay_ms: 1000 }${approval}`;
    })
    .join("\n\n");

  const edgeYaml = edges
    .map((e) => `  - { from: ${e.from}, output: ${e.output}, to: ${e.to}, input: ${e.input} }`)
    .join("\n");

  return `name: ${name}\n\nblocks:\n${blockYaml}\n\nedges:\n${edgeYaml || "  []"}\n`;
}
