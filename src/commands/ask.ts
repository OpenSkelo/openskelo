import chalk from "chalk";
import { cwd } from "node:process";
import { resolve } from "node:path";
import { loadAgent } from "../agents/loader.js";
import { executeChatTurn, buildSystemPrompt, createRuntime } from "./chat.js";

export async function askCommand(
  agentId: string,
  prompt: string,
  opts?: { projectDir?: string; json?: boolean }
): Promise<void> {
  const projectDir = resolve(opts?.projectDir ?? cwd());
  const agentDir = resolve(projectDir, "agents", agentId);

  const agent = await loadAgent(agentDir);
  const runtime = createRuntime(agent, projectDir);
  const system = buildSystemPrompt(agent, projectDir);

  const turn = await executeChatTurn(runtime, agent, projectDir, prompt, []);
  const failed = turn.gates.filter((g) => !g.passed);

  if (opts?.json) {
    console.log(
      JSON.stringify(
        {
          agent: agent.id,
          model: turn.result.modelUsed,
          content: turn.result.content,
          outputs: turn.result.outputs,
          gates: turn.gates,
          tokens: turn.result.tokens,
          cost: turn.result.cost,
          system,
        },
        null,
        2
      )
    );
  } else {
    console.log(chalk.bold(`${agent.name}:`));
    console.log(turn.result.content);
    if (turn.gates.length > 0) {
      console.log();
      console.log(chalk.bold("Gate Results"));
      for (const g of turn.gates) {
        if (g.passed) console.log(chalk.green(`✓ ${g.name}`));
        else console.log(chalk.red(`✗ ${g.name}: ${g.reason ?? "failed"}`));
      }
    }
    console.log();
    console.log(chalk.dim(`Tokens: ${turn.result.tokens.input} in / ${turn.result.tokens.output} out | Cost: $${turn.result.cost.toFixed(6)} | Model: ${turn.result.modelUsed}`));
  }

  if (failed.length > 0) {
    process.exitCode = 1;
  }
}
