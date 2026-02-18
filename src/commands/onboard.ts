import { Command } from "commander";
import chalk from "chalk";
import { confirm, intro, isCancel, outro, select, spinner, text } from "@clack/prompts";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
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

type AuthMode = "openai-key" | "openrouter-key" | "ollama" | "lmstudio" | "custom";
type TemplateMode = "content" | "coding" | "research" | "empty";

export function onboardCommand(cmd: Command): void {
  cmd
    .command("onboard")
    .description("Interactive onboarding wizard (recommended first-run setup)")
    .option("--reset", "Reset stored auth and start fresh", false)
    .option("--non-interactive", "Run wizard in non-interactive mode", false)
    .option("--auth <mode>", "openai-key|openrouter-key|ollama|lmstudio|custom")
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
      { value: "openai-key", label: "OpenAI API key" },
      { value: "openrouter-key", label: "OpenRouter API key" },
      { value: "ollama", label: "Local model (Ollama)" },
      { value: "lmstudio", label: "Local model (LM Studio)" },
      { value: "custom", label: "Custom OpenAI-compatible endpoint" },
    ],
  });
  if (isCancel(auth)) return cancel();

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

  let apiKey: string | undefined;
  if (auth === "openai-key" || auth === "openrouter-key") {
    const k = await text({ message: `Paste your ${auth === "openai-key" ? "OpenAI" : "OpenRouter"} API key` });
    if (isCancel(k)) return cancel();
    apiKey = String(k);
  }

  if (opts.reset) saveAuthStore({ version: 1, providers: {} });
  const s = spinner();
  s.start("Generating project and saving auth...");

  persistAuth(auth, apiKey);
  const outDir = resolve(String(dir));
  createProject(outDir, auth, String(model), template);

  s.stop("Setup complete");
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

  if ((auth === "openai-key" || auth === "openrouter-key") && !opts.apiKey) {
    console.error(chalk.red("✗ --api-key is required for key-based auth modes"));
    process.exit(3);
  }

  const model = opts.model ?? defaultModelFor(auth);
  const template = ((opts.template ?? "content") as TemplateMode);
  const outDir = resolve(opts.dir ?? "./my-skelo-project");

  if (opts.reset) saveAuthStore({ version: 1, providers: {} });
  persistAuth(auth, opts.apiKey);
  createProject(outDir, auth, model, template);

  console.log(chalk.green("✓ Onboarding complete"));
  console.log(chalk.dim(`  project: ${outDir}`));
  console.log(chalk.dim(`  run: skelo run ${template}-pipeline.yaml --input prompt=\"hello\" --watch`));
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

  const envLines: string[] = [];
  if (auth === "openai-key") envLines.push("OPENAI_API_KEY=");
  if (auth === "openrouter-key") envLines.push("OPENROUTER_API_KEY=");
  if (auth === "custom") envLines.push("CUSTOM_API_KEY=");
  if (envLines.length > 0) writeFileSync(resolve(dir, ".env"), `${envLines.join("\n")}\n`);
}

function providerConfigFor(auth: AuthMode): Record<string, unknown> {
  if (auth === "openai-key") return { name: "openai", type: "openai", url: "https://api.openai.com/v1", env: "OPENAI_API_KEY" };
  if (auth === "openrouter-key") return { name: "openrouter", type: "openrouter", url: "https://openrouter.ai/api/v1", env: "OPENROUTER_API_KEY" };
  if (auth === "ollama") return { name: "local", type: "ollama", url: "http://localhost:11434" };
  if (auth === "lmstudio") return { name: "lmstudio", type: "http", url: "http://localhost:1234/v1" };
  return { name: "custom", type: "http", url: "https://example.com/v1", env: "CUSTOM_API_KEY" };
}

function defaultModelFor(auth: AuthMode): string {
  if (auth === "openai-key") return "gpt-4o";
  if (auth === "openrouter-key") return "openai/gpt-4o";
  if (auth === "ollama") return "llama3.1:8b";
  if (auth === "lmstudio") return "local-model";
  return "gpt-4o-mini";
}

function templateDag(template: TemplateMode): string {
  if (template === "empty") {
    return `name: empty-pipeline\nentry: worker\nblocks:\n  - id: worker\n    mode: ai\n    agent: { role: worker }\n    inputs:\n      prompt: { type: string, description: User prompt }\n    outputs:\n      result: { type: string }\n    prompt: |\n      {{inputs.prompt}}\n`;}

  const topicName = template === "coding" ? "task" : template === "research" ? "question" : "topic";
  return `name: ${template}-pipeline\nentry: worker\nblocks:\n  - id: worker\n    mode: ai\n    agent: { role: worker }\n    inputs:\n      prompt: { type: string, description: ${topicName} to process }\n    outputs:\n      draft: { type: string }\n    prompt: |\n      Produce a high-quality ${template} draft for: {{inputs.prompt}}\n\n  - id: reviewer\n    mode: ai\n    agent: { role: reviewer }\n    inputs:\n      draft: { type: string }\n    outputs:\n      final: { type: string }\n    prompt: |\n      Review and improve this draft:\n      {{inputs.draft}}\n\nedges:\n  - from: worker\n    output: draft\n    to: reviewer\n    input: draft\n`;
}

function cancel(): void {
  outro("Setup cancelled.");
}
