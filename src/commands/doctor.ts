import chalk from "chalk";
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import yaml from "yaml";
import { getProviderToken } from "../core/auth.js";
import type { Provider } from "../types.js";

type CheckStatus = "ok" | "warn" | "fail";

export async function doctorCommand(opts?: { projectDir?: string }): Promise<void> {
  try {
    const dir = resolve(opts?.projectDir ?? process.cwd());
    const providers = loadProviders(dir);

    if (!providers.length) {
      console.log(chalk.yellow("⚠ No providers configured in skelo.yaml"));
      return;
    }

    let failCount = 0;
    let warnCount = 0;

    console.log(chalk.bold("🩺 OpenSkelo Doctor"));
    console.log(chalk.dim(`project: ${dir}`));

    for (const provider of providers) {
      const result = await checkProvider(provider, dir);
      if (result.status === "fail") failCount++;
      if (result.status === "warn") warnCount++;

      const icon = result.status === "ok" ? chalk.green("✓") : result.status === "warn" ? chalk.yellow("⚠") : chalk.red("✗");
      console.log(`${icon} ${provider.name} (${provider.type}) — ${result.message}`);
    }

    if (failCount > 0) {
      console.log(chalk.red(`\nDoctor found ${failCount} failing check(s).`));
      process.exitCode = 1;
      return;
    }

    if (warnCount > 0) {
      console.log(chalk.yellow(`\nDoctor completed with ${warnCount} warning(s).`));
      return;
    }

    console.log(chalk.green("\nAll provider checks passed."));
  } catch (err) {
    console.error(chalk.red(`✗ Doctor failed: ${String((err as Error).message ?? err)}`));
    process.exit(1);
  }
}

function loadProviders(projectDir: string): Provider[] {
  const skeloPath = join(projectDir, "skelo.yaml");
  if (!existsSync(skeloPath)) throw new Error("skelo.yaml not found");
  const parsed = yaml.parse(readFileSync(skeloPath, "utf-8")) as Record<string, unknown>;
  const list = Array.isArray(parsed?.providers) ? parsed.providers : [];
  return list as Provider[];
}

async function checkProvider(provider: Provider, projectDir: string): Promise<{ status: CheckStatus; message: string }> {
  if (provider.type === "ollama") {
    const base = (provider.url ?? "http://localhost:11434").replace(/\/$/, "");
    try {
      const res = await fetch(`${base}/api/tags`);
      if (res.ok) return { status: "ok", message: `reachable at ${base}` };
      return { status: "fail", message: `HTTP ${res.status} at ${base}/api/tags` };
    } catch (err) {
      return { status: "fail", message: `unreachable (${String((err as Error).message ?? err)})` };
    }
  }

  const baseUrl = (provider.url ?? defaultBaseUrl(provider.type)).replace(/\/$/, "");
  const endpoint = `${baseUrl}/models`;
  const token = resolveProviderToken(provider, projectDir);
  if (!token) {
    const envHint = provider.env ?? defaultEnvName(provider.type);
    return { status: "fail", message: `missing API key (set ${envHint} or .skelo/secrets.yaml)` };
  }

  const headers: Record<string, string> = { "content-type": "application/json" };
  if (provider.type === "anthropic") {
    headers["x-api-key"] = token;
    headers["anthropic-version"] = "2023-06-01";
  } else {
    headers["authorization"] = `Bearer ${token}`;
  }

  try {
    const res = await fetch(endpoint, { method: "GET", headers });
    if (res.ok) return { status: "ok", message: `auth ok at ${endpoint}` };
    if (res.status === 401 || res.status === 403) return { status: "fail", message: `auth rejected (HTTP ${res.status})` };
    if (res.status === 404) return { status: "warn", message: `endpoint not found (${endpoint})` };
    return { status: "fail", message: `HTTP ${res.status} at ${endpoint}` };
  } catch (err) {
    return { status: "fail", message: `unreachable (${String((err as Error).message ?? err)})` };
  }
}

function resolveProviderToken(provider: Provider, projectDir: string): string | null {
  const envName = provider.env ?? defaultEnvName(provider.type);
  const envToken = process.env[envName];
  if (envToken) return envToken;

  const authToken = getProviderToken(provider.name) ?? getProviderToken(provider.type);
  if (authToken) return authToken;

  const secretsPath = join(projectDir, ".skelo", "secrets.yaml");
  if (!existsSync(secretsPath)) return null;

  try {
    const secrets = yaml.parse(readFileSync(secretsPath, "utf-8")) as Record<string, string>;
    const keys = [
      `${provider.name}_api_key`,
      `${provider.type}_api_key`,
      defaultSecretKey(provider.type),
    ].filter(Boolean) as string[];

    for (const key of keys) {
      if (secrets?.[key]) return secrets[key];
    }
  } catch {
    return null;
  }

  return null;
}

function defaultBaseUrl(type: Provider["type"]): string {
  if (type === "openrouter") return "https://openrouter.ai/api/v1";
  if (type === "anthropic") return "https://api.anthropic.com/v1";
  if (type === "openai") return "https://api.openai.com/v1";
  if (type === "minimax") return "https://api.minimax.io/v1";
  if (type === "ollama") return "http://localhost:11434";
  return "";
}

function defaultEnvName(type: Provider["type"]): string {
  if (type === "openrouter") return "OPENROUTER_API_KEY";
  if (type === "anthropic") return "ANTHROPIC_API_KEY";
  if (type === "openai") return "OPENAI_API_KEY";
  if (type === "minimax") return "MINIMAX_API_KEY";
  return "API_KEY";
}

function defaultSecretKey(type: Provider["type"]): string {
  if (type === "openrouter") return "openrouter_api_key";
  if (type === "anthropic") return "anthropic_api_key";
  if (type === "openai") return "openai_api_key";
  if (type === "minimax") return "minimax_api_key";
  return "api_key";
}
