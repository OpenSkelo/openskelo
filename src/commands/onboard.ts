import { Command } from "commander";
import chalk from "chalk";
import { intro, isCancel, outro, select, spinner, text } from "@clack/prompts";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { stringify } from "yaml";
import { loadAuthStore, saveAuthStore, type AuthEntry, type AuthStore } from "../core/auth.js";

interface OnboardOpts {
  reset?: boolean;
  nonInteractive?: boolean;
  auth?: string;
  apiKey?: string;
  model?: string;
  template?: string;
  dir?: string;
}

type AuthMode = "openai-oauth" | "openai-key" | "openrouter-key" | "ollama" | "lmstudio" | "custom";
type TemplateMode = "content" | "coding" | "research" | "empty";

export function onboardCommand(cmd: Command): void {
  cmd
    .command("onboard")
    .description("Interactive onboarding wizard (recommended first-run setup)")
    .option("--reset", "Reset stored auth and start fresh", false)
    .option("--non-interactive", "Run wizard in non-interactive mode", false)
    .option("--auth <mode>", "openai-oauth|openai-key|openrouter-key|ollama|lmstudio|custom")
    .option("--api-key <key>", "API key for key-based auth modes")
    .option("--model <id>", "Default model")
    .option("--template <name>", "content|coding|research|empty", "content")
    .option("--dir <path>", "Project directory", "./my-skelo-project")
    .action(async (opts: OnboardOpts) => {
      await runOnboard(opts);
    });
}

async function runOnboard(opts: OnboardOpts): Promise<void> {
  if (opts.nonInteractive) {
    await runNonInteractive(opts);
    return;
  }

  intro("🦴 OpenSkelo Setup");

  const auth = await select<AuthMode>({
    message: "How do you want to connect to an LLM?",
    options: [
      { value: "openai-oauth", label: "Connect OpenAI account (existing subscription)" },
      { value: "openai-key", label: "OpenAI API key" },
      { value: "openrouter-key", label: "OpenRouter API key" },
      { value: "ollama", label: "Local model (Ollama)" },
      { value: "lmstudio", label: "Local model (LM Studio)" },
      { value: "custom", label: "Custom OpenAI-compatible endpoint" },
    ],
  });
  if (isCancel(auth)) return cancel();

  let apiKey: string | undefined;
  if (auth === "openai-oauth") {
    outro("OpenAI OAuth is selected. Full PKCE browser flow is landing in the next patch. For now use OpenAI API key or OpenRouter API key.");
    process.exit(2);
  }

  if (auth === "openai-key" || auth === "openrouter-key") {
    const k = await text({ message: `Paste your ${auth === "openai-key" ? "OpenAI" : "OpenRouter"} API key` });
    if (isCancel(k)) return cancel();
    apiKey = String(k);
  }

  const s = spinner();
  s.start("Verifying connection...");
  try {
    await verifyConnection(auth, apiKey);
    s.stop("Connection verified");
  } catch (err) {
    s.stop("Connection failed");
    console.error(chalk.red(`✗ ${String((err as Error).message ?? err)}`));
    process.exit(2);
  }

  const defaultModel = defaultModelFor(auth);
  const model = await text({ message: "Default model", placeholder: defaultModel, defaultValue: defaultModel });
  if (isCancel(model)) return cancel();

  const template = await select<TemplateMode>({
    message: "What kind of pipeline do you want to start with?",
    options: [
      { value: "content", label: "Content pipeline" },
      { value: "coding", label: "Coding pipeline" },
      { value: "research", label: "Research pipeline" },
      { value: "empty", label: "Empty" },
    ],
  });
  if (isCancel(template)) return cancel();

  const dir = await text({ message: "Project directory", defaultValue: "./my-skelo-project" });
  if (isCancel(dir)) return cancel();

  if (opts.reset) saveAuthStore({ version: 1, providers: {} });
  const setupSpinner = spinner();
  setupSpinner.start("Generating project and saving auth...");

  persistAuth(auth, apiKey);
  const outDir = resolve(String(dir));
  createProject(outDir, auth, String(model), template);

  setupSpinner.stop("Setup complete");
  outro([
    `✓ Created ${outDir}/skelo.yaml`,
    `✓ Created ${outDir}/${template}-pipeline.yaml`,
    "",
    "🔥 Ready! Run your first pipeline:",
    `cd ${outDir}`,
    `skelo run ${template}-pipeline.yaml --input prompt=\"hello\" --watch`,
  ].join("\n"));
}

async function runNonInteractive(opts: OnboardOpts): Promise<void> {
  const auth = (opts.auth ?? "").trim() as AuthMode;
  if (!auth) {
    console.error(chalk.red("✗ --auth is required in --non-interactive mode"));
    process.exit(3);
  }
  if (auth === "openai-oauth") {
    console.error(chalk.red("✗ openai-oauth non-interactive flow is not implemented yet. Use openai-key for now."));
    process.exit(2);
  }

  if ((auth === "openai-key" || auth === "openrouter-key") && !opts.apiKey) {
    console.error(chalk.red("✗ --api-key is required for key-based auth modes"));
    process.exit(3);
  }

  const model = opts.model ?? defaultModelFor(auth);
  const template = ((opts.template ?? "content") as TemplateMode);
  const outDir = resolve(opts.dir ?? "./my-skelo-project");

  await verifyConnection(auth, opts.apiKey);

  if (opts.reset) saveAuthStore({ version: 1, providers: {} });
  persistAuth(auth, opts.apiKey);
  createProject(outDir, auth, model, template);

  console.log(chalk.green("✓ Onboarding complete"));
  console.log(chalk.dim(`  project: ${outDir}`));
  console.log(chalk.dim(`  run: skelo run ${template}-pipeline.yaml --input prompt=\"hello\" --watch`));
}

async function verifyConnection(auth: AuthMode, apiKey?: string): Promise<void> {
  if (auth === "openai-key") {
    if (!apiKey?.startsWith("sk-")) throw new Error("OpenAI API key must start with 'sk-'.");
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({ model: "gpt-4o-mini", messages: [{ role: "user", content: "Say OK" }], max_tokens: 5 }),
    });
    if (!res.ok) throw new Error(`OpenAI validation failed (${res.status}). Check your key.`);
    return;
  }

  if (auth === "openrouter-key") {
    if (!apiKey?.startsWith("sk-or-")) throw new Error("OpenRouter API key must start with 'sk-or-'.");
    const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({ model: "openai/gpt-4o-mini", messages: [{ role: "user", content: "Say OK" }], max_tokens: 5 }),
    });
    if (!res.ok) throw new Error(`OpenRouter validation failed (${res.status}). Check your key.`);
    return;
  }

  if (auth === "ollama") {
    const res = await fetch("http://localhost:11434/api/tags");
    if (!res.ok) throw new Error("Could not reach Ollama at http://localhost:11434. Is it running?");
    return;
  }

  if (auth === "lmstudio") {
    const res = await fetch("http://localhost:1234/v1/models");
    if (!res.ok) throw new Error("Could not reach LM Studio at http://localhost:1234. Is it running?");
    return;
  }

  if (auth === "custom") {
    throw new Error("Custom endpoint onboarding validation is not implemented yet. Use openai-key/openrouter-key/ollama/lmstudio for now.");
  }
}

function persistAuth(auth: AuthMode, apiKey?: string): void {
  const store: AuthStore = loadAuthStore() ?? { version: 1, providers: {} };
  const now = new Date().toISOString();

  let entry: AuthEntry | null = null;
  if (auth === "openai-key") {
    entry = { type: "api_key", api_key: apiKey, created_at: now };
    store.providers.openai = entry;
  } else if (auth === "openrouter-key") {
    entry = { type: "api_key", api_key: apiKey, created_at: now };
    store.providers.openrouter = entry;
  }

  saveAuthStore(store);
}

function createProject(dir: string, auth: AuthMode, model: string, template: TemplateMode): void {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

  const projectName = dir.split("/").filter(Boolean).pop() ?? "my-skelo-project";
  const provider = providerConfigFor(auth);
  const providerName = provider.name;

  const skelo = {
    name: projectName,
    providers: [provider],
    agents: {
      worker: {
        role: "worker",
        capabilities: ["general"],
        provider: providerName,
        model,
        max_concurrent: 1,
      },
      reviewer: {
        role: "reviewer",
        capabilities: ["qa"],
        provider: providerName,
        model,
        max_concurrent: 1,
      },
    },
    storage: "sqlite",
    dashboard: { enabled: true, port: 4040 },
  };

  writeFileSync(resolve(dir, "skelo.yaml"), stringify(skelo));
  writeFileSync(resolve(dir, `${template}-pipeline.yaml`), templateDag(template));

  // Auth source of truth is ~/.skelo/auth.json; no empty key placeholders in project files.
}

function providerConfigFor(auth: AuthMode): Record<string, unknown> {
  if (auth === "openai-oauth") return { name: "openai", type: "openai", url: "https://api.openai.com/v1" };
  if (auth === "openai-key") return { name: "openai", type: "openai", url: "https://api.openai.com/v1", env: "OPENAI_API_KEY" };
  if (auth === "openrouter-key") return { name: "openrouter", type: "openrouter", url: "https://openrouter.ai/api/v1", env: "OPENROUTER_API_KEY" };
  if (auth === "ollama") return { name: "local", type: "ollama", url: "http://localhost:11434" };
  if (auth === "lmstudio") return { name: "lmstudio", type: "http", url: "http://localhost:1234/v1" };
  return { name: "custom", type: "http", url: "https://example.com/v1", env: "CUSTOM_API_KEY" };
}

function defaultModelFor(auth: AuthMode): string {
  if (auth === "openai-oauth") return "gpt-4o";
  if (auth === "openai-key") return "gpt-4o";
  if (auth === "openrouter-key") return "openai/gpt-4o";
  if (auth === "ollama") return "llama3.1:8b";
  if (auth === "lmstudio") return "local-model";
  return "gpt-4o-mini";
}

function templateDag(template: TemplateMode): string {
  if (template === "empty") {
    return stringify({
      name: "empty-pipeline",
      blocks: [
        {
          id: "worker",
          name: "Worker",
          mode: "ai",
          inputs: { prompt: { type: "string", description: "User prompt" } },
          outputs: { result: { type: "string", description: "Worker result" } },
          agent: { role: "worker" },
          pre_gates: [],
          post_gates: [
            { name: "has-result", check: { type: "port_not_empty", port: "result" }, error: "Must produce result" },
          ],
          retry: { max_attempts: 0, backoff: "none", delay_ms: 0 },
        },
      ],
      edges: [],
    });
  }

  const draftPort = template === "coding" ? "code_draft" : template === "research" ? "analysis_draft" : "content_draft";
  return stringify({
    name: `${template}-pipeline`,
    blocks: [
      {
        id: "worker",
        name: "Initial Draft",
        mode: "ai",
        inputs: { prompt: { type: "string", description: "Task prompt" } },
        outputs: { [draftPort]: { type: "string", description: "Initial draft output" } },
        agent: { role: "worker" },
        pre_gates: [
          { name: "has-prompt", check: { type: "port_not_empty", port: "prompt" }, error: "Prompt is required" },
        ],
        post_gates: [],
        retry: { max_attempts: 1, backoff: "none", delay_ms: 0 },
      },
      {
        id: "reviewer",
        name: "Review & Improve",
        mode: "ai",
        inputs: { [draftPort]: { type: "string", description: "Draft to review" } },
        outputs: { final: { type: "string", description: "Final improved output" } },
        agent: { role: "reviewer" },
        pre_gates: [],
        post_gates: [
          { name: "has-final", check: { type: "port_not_empty", port: "final" }, error: "Final output required" },
        ],
        retry: { max_attempts: 0, backoff: "none", delay_ms: 0 },
      },
    ],
    edges: [{ from: "worker", output: draftPort, to: "reviewer", input: draftPort }],
  });
}

function cancel(): void {
  outro("Setup cancelled.");
}
