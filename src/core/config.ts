import { readFileSync, existsSync } from "fs";
import { resolve } from "path";
import type { SkeloConfig } from "../types.js";
import { parseYamlWithDiagnostics } from "./yaml-utils.js";

const CONFIG_FILES = ["skelo.yaml", "skelo.yml", "openskelo.yaml", "openskelo.yml"];

export function findConfigFile(dir: string = process.cwd()): string | null {
  for (const file of CONFIG_FILES) {
    const path = resolve(dir, file);
    if (existsSync(path)) return path;
  }
  return null;
}

export function loadConfig(dir?: string): SkeloConfig {
  const configPath = findConfigFile(dir);
  if (!configPath) {
    throw new Error(
      `No skelo.yaml found. Run 'skelo init' to create a project, or create skelo.yaml manually.`
    );
  }

  const raw = readFileSync(configPath, "utf-8");
  const parsed = parseYamlWithDiagnostics(raw, configPath);

  return validateConfig(parsed);
}

function validateConfig(raw: unknown): SkeloConfig {
  if (!raw || typeof raw !== "object") {
    throw new Error("skelo.yaml must be a YAML object");
  }

  const config = raw as Record<string, unknown>;

  // Required fields
  if (!config.name || typeof config.name !== "string") {
    throw new Error("skelo.yaml: 'name' is required (string)");
  }

  if (!config.agents || typeof config.agents !== "object") {
    throw new Error("skelo.yaml: 'agents' is required (object)");
  }

  const hasPipelines = Boolean(config.pipelines && typeof config.pipelines === "object");
  const hasDag = Array.isArray((config as Record<string, unknown>).blocks);

  if (!hasPipelines && !hasDag) {
    throw new Error("skelo.yaml: either 'pipelines' (legacy) or top-level DAG 'blocks' is required");
  }

  // Validate agents
  const agents = config.agents as Record<string, Record<string, unknown>>;
  for (const [id, agent] of Object.entries(agents)) {
    if (!agent.role) throw new Error(`Agent '${id}': 'role' is required`);
    if (!agent.provider) throw new Error(`Agent '${id}': 'provider' is required`);
    if (!agent.model) throw new Error(`Agent '${id}': 'model' is required`);

    const validRoles = ["worker", "reviewer", "manager", "specialist"];
    if (!validRoles.includes(agent.role as string)) {
      throw new Error(`Agent '${id}': role must be one of: ${validRoles.join(", ")}`);
    }
  }

  // Validate pipelines (legacy config path)
  const pipelines = (hasPipelines ? (config.pipelines as Record<string, Record<string, unknown>>) : {});
  for (const [id, pipeline] of Object.entries(pipelines)) {
    if (!pipeline.stages || !Array.isArray(pipeline.stages)) {
      throw new Error(`Pipeline '${id}': 'stages' is required (array)`);
    }
    if (pipeline.stages.length < 2) {
      throw new Error(`Pipeline '${id}': must have at least 2 stages`);
    }
  }

  // Validate gates reference valid fields
  const gates = (config.gates ?? []) as Array<Record<string, unknown>>;
  for (const gate of gates) {
    if (!gate.name) throw new Error("Gate: 'name' is required");
    if (!gate.on) throw new Error(`Gate '${gate.name}': 'on' is required`);
    if (!gate.check) throw new Error(`Gate '${gate.name}': 'check' is required`);
    if (!gate.error) throw new Error(`Gate '${gate.name}': 'error' is required`);
  }

  // Validate providers if present
  const providers = (config.providers ?? []) as Array<Record<string, unknown>>;
  for (const provider of providers) {
    if (!provider.name) throw new Error("Provider: 'name' is required");
    if (!provider.type) throw new Error(`Provider '${provider.name}': 'type' is required`);
  }

  return {
    name: config.name as string,
    providers: (config.providers ?? []) as SkeloConfig["providers"],
    agents: config.agents as SkeloConfig["agents"],
    pipelines: config.pipelines as SkeloConfig["pipelines"],
    gates: (config.gates ?? []) as SkeloConfig["gates"],
    storage: (config.storage as SkeloConfig["storage"]) ?? "sqlite",
    dashboard: {
      enabled: (config.dashboard as Record<string, unknown>)?.enabled !== false,
      port: ((config.dashboard as Record<string, unknown>)?.port as number) ?? 4040,
    },
  };
}
