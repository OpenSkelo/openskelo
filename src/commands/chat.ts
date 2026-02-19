import chalk from "chalk";
import readline from "node:readline";
import { cwd } from "node:process";
import { join, resolve } from "node:path";
import { readFileSync, existsSync } from "node:fs";
import yaml from "yaml";
import { loadAgent } from "../agents/loader.js";
import type { AgentConfig } from "../agents/types.js";
import { loadBlockContext } from "../core/block-context.js";
import { DirectRuntime, type DirectDispatchResult } from "../runtimes/direct-runtime.js";
import { AnthropicProvider } from "../runtimes/providers/anthropic.js";
import { OpenAIProvider } from "../runtimes/providers/openai.js";
import { createOpenRouterProvider } from "../runtimes/providers/openrouter.js";
import type { LLMProvider, Message } from "../runtimes/providers/types.js";
import { getProviderToken } from "../core/auth.js";

interface ChatState {
  history: Message[];
  sessionCost: number;
  sessionInputTokens: number;
  sessionOutputTokens: number;
}

interface GateResult {
  name: string;
  passed: boolean;
  reason?: string;
}

export async function chatCommand(agentId: string, opts?: { projectDir?: string }): Promise<void> {
  const projectDir = resolve(opts?.projectDir ?? cwd());
  const agentDir = resolve(projectDir, "agents", agentId);
  const agent = await loadAgent(agentDir);
  const runtime = createRuntime(agent, projectDir);
  const state: ChatState = { history: [], sessionCost: 0, sessionInputTokens: 0, sessionOutputTokens: 0 };

  console.log(chalk.cyan(`\nChatting with ${agent.name} (${agent.model.primary}) — type /quit to exit\n`));

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

  const ask = () => {
    rl.question("You: ", async (raw) => {
      const input = raw.trim();
      if (!input) return ask();

      if (input === "/quit") {
        rl.close();
        return;
      }
      if (input === "/clear") {
        state.history = [];
        console.log(chalk.dim("history cleared\n"));
        return ask();
      }
      if (input === "/cost") {
        console.log(chalk.dim(`session tokens: ${state.sessionInputTokens} in / ${state.sessionOutputTokens} out | cost: $${state.sessionCost.toFixed(6)}\n`));
        return ask();
      }
      if (input === "/system") {
        console.log(chalk.yellow(buildSystemPrompt(agent, projectDir)) + "\n");
        return ask();
      }

      try {
        const turn = await executeChatTurn(runtime, agent, projectDir, input, state.history);
        state.sessionCost += turn.result.cost;
        state.sessionInputTokens += turn.result.tokens.input;
        state.sessionOutputTokens += turn.result.tokens.output;

        console.log(`\n${agent.name}: ${turn.result.content}\n`);
        printGates(turn.gates);
        console.log(chalk.dim(`Tokens: ${turn.result.tokens.input} in / ${turn.result.tokens.output} out | Cost: $${turn.result.cost.toFixed(6)} | Model: ${turn.result.modelUsed}\n`));

        state.history.push({ role: "user", content: input });
        state.history.push({ role: "assistant", content: turn.result.content });
      } catch (err) {
        console.error(chalk.red(`Error: ${err instanceof Error ? err.message : String(err)}`));
      }

      ask();
    });
  };

  ask();
}

export async function executeChatTurn(
  runtime: DirectRuntime,
  agent: AgentConfig,
  projectDir: string,
  input: string,
  history: Message[]
): Promise<{ result: DirectDispatchResult; gates: GateResult[] }> {
  const system = buildSystemPrompt(agent, projectDir);

  let feedback = "";
  const maxAttempts = Math.max(1, agent.retry?.max_attempts ?? 1);
  let lastResult: DirectDispatchResult | null = null;
  let lastGates: GateResult[] = [];

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const userMessage = buildUserPrompt(input, history, feedback);
    const result = await runtime.dispatch({
      agentId: agent.id,
      system,
      userMessage,
      inputs: {},
      model: agent.model.primary,
      params: {
        temperature: agent.model.params?.temperature,
        maxTokens: agent.model.params?.max_tokens,
      },
      timeoutMs: agent.timeout_ms,
    });

    const gates = evaluateAgentGates(agent, result.content);
    lastResult = result;
    lastGates = gates;

    const failed = gates.find((g: GateResult) => !g.passed);
    if (!failed) return { result, gates };

    const action = agent.on_gate_fail.find((a: { gate: string; action: string; max?: number; feedback?: string }) => a.gate === failed.name && a.action === "retry");
    const retryMax = action?.max ?? 0;
    if (attempt >= retryMax + 1) break;

    feedback = action?.feedback ?? `Previous response failed gate '${failed.name}': ${failed.reason ?? "unknown"}. Fix and retry.`;
  }

  if (!lastResult) throw new Error("No dispatch result");
  return { result: lastResult, gates: lastGates };
}

export function evaluateAgentGates(agent: AgentConfig, content: string): GateResult[] {
  const outputs: Record<string, unknown> = { default: content };

  return agent.gates.post.map((g) => {
    const check = g.check;
    if (check.type === "port_not_empty") {
      const val = outputs[String(check.port ?? "default")];
      const ok = val !== undefined && val !== null && String(val).trim() !== "";
      return { name: g.name, passed: ok, reason: ok ? undefined : g.error ?? "empty output" };
    }

    if (check.type === "regex") {
      const val = String(outputs[String(check.port ?? "default")] ?? "");
      const pattern = check.pattern ?? ".*";
      const ok = new RegExp(pattern).test(val);
      return { name: g.name, passed: ok, reason: ok ? undefined : g.error ?? `regex ${pattern} failed` };
    }

    if (check.type === "word_count") {
      const val = String(outputs[String(check.port ?? "default")] ?? "");
      const words = val.trim() ? val.trim().split(/\s+/).length : 0;
      const min = check.min ?? 0;
      const max = check.max ?? Number.MAX_SAFE_INTEGER;
      const ok = words >= min && words <= max;
      return { name: g.name, passed: ok, reason: ok ? undefined : g.error ?? `word count ${words} outside ${min}-${max}` };
    }

    if (check.type === "json_schema") {
      const port = String(check.port ?? "default");
      const val = String(outputs[port] ?? "");
      try {
        const parsed = JSON.parse(val);
        const req = Array.isArray((check.schema as any)?.required) ? (check.schema as any).required.map(String) : [];
        const ok = req.every((k: string) => parsed && typeof parsed === "object" && k in parsed);
        return { name: g.name, passed: ok, reason: ok ? undefined : g.error ?? "schema required fields missing" };
      } catch {
        return { name: g.name, passed: false, reason: g.error ?? "invalid json" };
      }
    }

    if (check.type === "expression") {
      return { name: g.name, passed: true };
    }

    if (check.type === "llm_review") {
      return { name: g.name, passed: true }; // deferred in chat v1
    }

    return { name: g.name, passed: true };
  });
}

function printGates(gates: GateResult[]): void {
  if (gates.length === 0) return;
  console.log(chalk.bold("── Gate Results ──────────────────────────────────"));
  for (const g of gates) {
    if (g.passed) console.log(chalk.green(`✓ ${g.name}: passed`));
    else console.log(chalk.red(`✗ ${g.name}: FAILED — ${g.reason ?? "unknown"}`));
  }
  console.log();
}

function buildUserPrompt(input: string, history: Message[], feedback: string): string {
  const chunks: string[] = [];
  if (history.length > 0) {
    const lastTurns = history.slice(-8).map((m) => `${m.role.toUpperCase()}: ${m.content}`);
    chunks.push(`Conversation context:\n${lastTurns.join("\n")}`);
  }
  if (feedback) chunks.push(`Retry feedback:\n${feedback}`);
  chunks.push(input);
  return chunks.join("\n\n---\n\n");
}

function buildSystemPrompt(agent: AgentConfig, projectDir: string): string {
  const ctx = loadBlockContext(`agents/${agent.id}`, projectDir);
  const sections: string[] = [];
  if (ctx.role) sections.push(ctx.role);
  if (ctx.rules) sections.push(`## RULES — NEVER VIOLATE\n\n${ctx.rules}`);
  if (ctx.policies) sections.push(ctx.policies);
  if (ctx.skill_summaries) sections.push(ctx.skill_summaries);
  if (ctx.context) sections.push(ctx.context);
  return sections.join("\n\n---\n\n");
}

function createRuntime(agent: AgentConfig, projectDir: string): DirectRuntime {
  const providerName = inferProviderName(agent.model.primary, projectDir, agent.id);
  const token = resolveToken(providerName, projectDir);

  const providers = new Map<string, LLMProvider>();
  const modelMap = new Map<string, string>();

  if (providerName === "anthropic") providers.set("anthropic", new AnthropicProvider(token));
  if (providerName === "openai") providers.set("openai", new OpenAIProvider(token));
  if (providerName === "openrouter") providers.set("openrouter", createOpenRouterProvider(token));

  modelMap.set(agent.model.primary, providerName);
  for (const fb of agent.model.fallbacks ?? []) modelMap.set(fb, providerName);

  return new DirectRuntime({ providers, modelToProvider: modelMap });
}

function inferProviderName(model: string, projectDir: string, agentId: string): "anthropic" | "openai" | "openrouter" {
  if (model.startsWith("claude-")) return "anthropic";
  if (model.includes("/")) return "openrouter";
  if (model.startsWith("gpt-")) return "openai";

  const skeloPath = join(projectDir, "skelo.yaml");
  if (existsSync(skeloPath)) {
    try {
      const parsed = yaml.parse(readFileSync(skeloPath, "utf-8")) as any;
      const providers = Array.isArray(parsed?.providers) ? parsed.providers : [];
      const agents = parsed?.agents ?? {};
      const configured = agents?.[agentId]?.provider;
      const provider = providers.find((p: any) => p?.name === configured);
      const type = String(provider?.type ?? "");
      if (type === "anthropic" || type === "openai" || type === "openrouter") return type;
    } catch {
      // ignore
    }
  }

  return "openai";
}

function resolveToken(provider: "anthropic" | "openai" | "openrouter", projectDir: string): string {
  const envName = provider === "anthropic" ? "ANTHROPIC_API_KEY" : provider === "openai" ? "OPENAI_API_KEY" : "OPENROUTER_API_KEY";
  const envToken = process.env[envName];
  if (envToken) return envToken;

  const authToken = getProviderToken(provider);
  if (authToken) return authToken;

  const secretsPath = join(projectDir, ".skelo", "secrets.enc.yaml");
  if (existsSync(secretsPath)) {
    try {
      const parsed = yaml.parse(readFileSync(secretsPath, "utf-8")) as Record<string, string>;
      const keyName = provider === "anthropic" ? "anthropic_api_key" : provider === "openai" ? "openai_api_key" : "openrouter_api_key";
      if (parsed?.[keyName]) return parsed[keyName];
    } catch {
      // ignore
    }
  }

  throw new Error(`Missing API key for ${provider}. Set ${envName}, ~/.skelo/auth.json, or .skelo/secrets.enc.yaml`);
}
