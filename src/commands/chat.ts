import chalk from "chalk";
import readline from "node:readline";
import { cwd } from "node:process";
import { join, resolve } from "node:path";
import { readFileSync, existsSync } from "node:fs";
import yaml from "yaml";
import { loadAgent } from "../agents/loader.js";
import type { AgentConfig } from "../agents/types.js";
import { loadBlockContext } from "../core/block-context.js";
import { evaluateBlockGates } from "../core/gate-runtime.js";
import type { BlockGate, GateResult } from "../core/block-types.js";
import { DirectRuntime, type DirectDispatchResult } from "../runtimes/direct-runtime.js";
import { AnthropicProvider } from "../runtimes/providers/anthropic.js";
import { OpenAIProvider } from "../runtimes/providers/openai.js";
import { createOpenRouterProvider } from "../runtimes/providers/openrouter.js";
import type { LLMProvider, Message } from "../runtimes/providers/types.js";
import { getProviderToken } from "../core/auth.js";
import { createDB } from "../core/db.js";
import { CostTracker } from "../persistence/cost-tracker.js";
import { randomUUID } from "node:crypto";

interface ChatState {
  history: Message[];
  sessionCost: number;
  sessionInputTokens: number;
  sessionOutputTokens: number;
}

// GateResult imported from core/block-types for runtime parity with DAG gates.

export async function chatCommand(agentId: string, opts?: { projectDir?: string }): Promise<void> {
  const projectDir = resolve(opts?.projectDir ?? cwd());
  const agentDir = resolve(projectDir, "agents", agentId);
  const agent = await loadAgent(agentDir);
  const runtime = createRuntime(agent, projectDir);
  const db = createDB(projectDir);
  const costTracker = new CostTracker(db);
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

        await costTracker.record({
          agentId: agent.id,
          runId: `chat_${randomUUID()}`,
          model: turn.result.modelUsed,
          inputTokens: turn.result.tokens.input,
          outputTokens: turn.result.tokens.output,
          costUsd: turn.result.cost,
          durationMs: turn.result.durationMs,
        });

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

    const gates = await evaluateAgentGates(agent, result.content, runtime);
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

export async function evaluateAgentGates(agent: AgentConfig, content: string, runtime?: DirectRuntime): Promise<GateResult[]> {
  const outputs: Record<string, unknown> = { default: content };

  const sharedGates: BlockGate[] = [];
  const immediateResults: GateResult[] = [];

  for (const g of agent.gates.post) {
    const check = g.check;

    if (check.type === "regex") {
      const val = String(outputs[String(check.port ?? "default")] ?? "");
      const pattern = check.pattern ?? ".*";
      const ok = new RegExp(pattern).test(val);
      immediateResults.push({ name: g.name, passed: ok, reason: ok ? undefined : g.error ?? `regex ${pattern} failed` });
      continue;
    }

    if (check.type === "word_count") {
      const val = String(outputs[String(check.port ?? "default")] ?? "");
      const words = val.trim() ? val.trim().split(/\s+/).length : 0;
      const min = check.min ?? 0;
      const max = check.max ?? Number.MAX_SAFE_INTEGER;
      const ok = words >= min && words <= max;
      immediateResults.push({ name: g.name, passed: ok, reason: ok ? undefined : g.error ?? `word count ${words} outside ${min}-${max}` });
      continue;
    }

    if (check.type === "json_schema") {
      const port = String(check.port ?? "default");
      const raw = outputs[port];
      if (typeof raw === "string") {
        try {
          outputs[port] = JSON.parse(raw);
        } catch {
          immediateResults.push({ name: g.name, passed: false, reason: g.error ?? "invalid json" });
          continue;
        }
      }
      sharedGates.push({
        name: g.name,
        error: g.error ?? "schema validation failed",
        check: { type: "json_schema", port, schema: check.schema ?? {} },
      });
      continue;
    }

    if (check.type === "expression") {
      if (!check.expression?.trim()) {
        immediateResults.push({ name: g.name, passed: false, reason: g.error ?? "missing expression" });
        continue;
      }
      sharedGates.push({
        name: g.name,
        error: g.error ?? "expression gate failed",
        check: { type: "expr", expression: check.expression },
      });
      continue;
    }

    if (check.type === "port_not_empty") {
      sharedGates.push({
        name: g.name,
        error: g.error ?? "empty output",
        check: { type: "port_not_empty", port: String(check.port ?? "default") },
      });
      continue;
    }

    if (check.type === "llm_review") {
      sharedGates.push({
        name: g.name,
        error: g.error ?? "llm review failed",
        check: {
          type: "llm_review",
          port: String(check.port ?? "default"),
          criteria: Array.isArray(check.criteria) ? check.criteria : [],
          model: check.model,
          provider: check.provider,
          pass_threshold: check.pass_threshold,
          timeout_ms: check.timeout_ms,
          system_prompt: check.system_prompt,
        },
      });
      continue;
    }

    immediateResults.push({ name: g.name, passed: true });
  }

  const sharedResults = await evaluateBlockGates(sharedGates, {
    inputs: {},
    outputs,
    llmReview: runtime
      ? async ({ gate, systemPrompt, reviewPrompt }) => {
          try {
            const model = gate.check.model ?? agent.model.primary;
            const review = await runtime.dispatch({
              agentId: agent.id,
              system: systemPrompt,
              userMessage: reviewPrompt,
              inputs: {},
              model,
              timeoutMs: gate.check.timeout_ms ?? agent.timeout_ms,
            });

            return {
              success: true,
              output: review.content,
              tokensUsed: review.tokens.input + review.tokens.output,
              audit: {
                provider: gate.check.provider ?? "runtime-resolved",
                model,
              },
            };
          } catch (err) {
            return {
              success: false,
              error: err instanceof Error ? err.message : String(err),
              audit: {
                provider: gate.check.provider ?? "runtime-resolved",
                model: gate.check.model ?? agent.model.primary,
              },
            };
          }
        }
      : undefined,
  });

  const resultByName = new Map<string, GateResult>();
  for (const r of [...immediateResults, ...sharedResults]) resultByName.set(r.name, r);

  return agent.gates.post.map((g) => resultByName.get(g.name) ?? { name: g.name, passed: true });
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

export function buildSystemPrompt(agent: AgentConfig, projectDir: string): string {
  const ctx = loadBlockContext(`agents/${agent.id}`, projectDir);
  const sections: string[] = [];
  if (ctx.role) sections.push(ctx.role);
  if (ctx.rules) sections.push(`## RULES — NEVER VIOLATE\n\n${ctx.rules}`);
  if (ctx.policies) sections.push(ctx.policies);
  if (ctx.skill_summaries) sections.push(ctx.skill_summaries);
  if (ctx.context) sections.push(ctx.context);
  return sections.join("\n\n---\n\n");
}

export function createRuntime(agent: AgentConfig, projectDir: string): DirectRuntime {
  const resolved = resolveProvider(agent.model.primary, projectDir, agent.id);
  const token = resolveToken(resolved, projectDir);

  const providers = new Map<string, LLMProvider>();
  const modelMap = new Map<string, string>();

  if (resolved.kind === "anthropic") {
    providers.set("anthropic", new AnthropicProvider(token, resolved.baseUrl));
    modelMap.set(agent.model.primary, "anthropic");
    for (const fb of agent.model.fallbacks ?? []) modelMap.set(fb, "anthropic");
  } else if (resolved.kind === "openrouter") {
    providers.set("openrouter", createOpenRouterProvider(token));
    modelMap.set(agent.model.primary, "openrouter");
    for (const fb of agent.model.fallbacks ?? []) modelMap.set(fb, "openrouter");
  } else {
    const providerKey = "openai";
    providers.set(providerKey, new OpenAIProvider(token, resolved.baseUrl, resolved.name));
    modelMap.set(agent.model.primary, providerKey);
    for (const fb of agent.model.fallbacks ?? []) modelMap.set(fb, providerKey);
  }

  return new DirectRuntime({ providers, modelToProvider: modelMap });
}

type ResolvedProvider = {
  kind: "anthropic" | "openai" | "openrouter";
  name: string;
  env?: string;
  baseUrl?: string;
};

function resolveProvider(model: string, projectDir: string, agentId: string): ResolvedProvider {
  if (model.startsWith("claude-")) return { kind: "anthropic", name: "anthropic" };
  if (model.startsWith("MiniMax-")) return { kind: "openai", name: "minimax", env: "MINIMAX_API_KEY", baseUrl: "https://api.minimax.io/v1" };
  if (model.includes("/")) return { kind: "openrouter", name: "openrouter" };
  if (model.startsWith("gpt-")) return { kind: "openai", name: "openai" };

  const skeloPath = join(projectDir, "skelo.yaml");
  if (existsSync(skeloPath)) {
    try {
      const parsed = yaml.parse(readFileSync(skeloPath, "utf-8")) as any;
      const providers = Array.isArray(parsed?.providers) ? parsed.providers : [];
      const agents = parsed?.agents ?? {};
      const configured = agents?.[agentId]?.provider;
      const provider = providers.find((p: any) => p?.name === configured);
      const type = String(provider?.type ?? "");
      const name = String(provider?.name ?? type ?? "openai");
      const env = typeof provider?.env === "string" ? String(provider.env) : undefined;
      const baseUrl = typeof provider?.url === "string" ? String(provider.url) : undefined;
      if (type === "anthropic" || type === "openai" || type === "openrouter") {
        return { kind: type, name, env, baseUrl };
      }
      if (type === "minimax") {
        return {
          kind: "openai",
          name: name || "minimax",
          env: env || "MINIMAX_API_KEY",
          baseUrl: baseUrl || "https://api.minimax.io/v1",
        };
      }
    } catch {
      // ignore
    }
  }

  return { kind: "openai", name: "openai" };
}

function resolveToken(provider: ResolvedProvider, projectDir: string): string {
  const defaultEnvName = provider.kind === "anthropic"
    ? "ANTHROPIC_API_KEY"
    : provider.kind === "openrouter"
      ? "OPENROUTER_API_KEY"
      : "OPENAI_API_KEY";

  const envName = provider.env || defaultEnvName;
  const envToken = process.env[envName];
  if (envToken) return envToken;

  const authToken = getProviderToken(provider.name) ?? getProviderToken(provider.kind);
  if (authToken) return authToken;

  const secretsPath = join(projectDir, ".skelo", "secrets.yaml");
  if (existsSync(secretsPath)) {
    try {
      const parsed = yaml.parse(readFileSync(secretsPath, "utf-8")) as Record<string, string>;
      const secretKeys = [
        `${provider.name}_api_key`,
        `${provider.kind}_api_key`,
        provider.kind === "openai" ? "openai_api_key" : undefined,
      ].filter(Boolean) as string[];

      for (const key of secretKeys) {
        if (parsed?.[key]) return parsed[key];
      }
    } catch {
      // ignore
    }
  }

  throw new Error(`Missing API key for ${provider.name}. Set ${envName}, ~/.skelo/auth.json, or .skelo/secrets.yaml`);
}
