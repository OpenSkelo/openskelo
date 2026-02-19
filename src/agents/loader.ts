import * as fs from "node:fs/promises";
import * as path from "node:path";
import yaml from "yaml";
import { AgentYamlSchema } from "./schema.js";
import type { AgentConfig } from "./types.js";

export async function loadAgent(agentDir: string): Promise<AgentConfig> {
  const yamlPath = path.join(agentDir, "agent.yaml");
  if (!(await fileExists(yamlPath))) {
    throw new Error(`No agent.yaml found in ${agentDir}`);
  }

  const raw = yaml.parse(await fs.readFile(yamlPath, "utf-8"));
  const parsed = AgentYamlSchema.parse(raw);

  return {
    ...parsed,
    dir: agentDir,
    hasRole: await fileExists(path.join(agentDir, "role.md")),
    hasTask: await fileExists(path.join(agentDir, "task.md")),
    hasRules: await fileExists(path.join(agentDir, "rules.md")),
    hasSkills: await dirHasFiles(path.join(agentDir, "skills"), ".md"),
    hasContext: await dirHasFiles(path.join(agentDir, "context"), ".md"),
    hasMcp: await fileExists(path.join(agentDir, "mcp.json")),
    hasMemory: await fileExists(path.join(agentDir, "memory.json")),
    hasPolicies: await dirHasFiles(path.join(agentDir, "policies"), ".yaml", ".yml"),
    hasProcedural: await dirHasFiles(path.join(agentDir, "procedural"), ".md"),
  };
}

export async function loadAllAgents(agentsDir: string): Promise<Map<string, AgentConfig>> {
  const agents = new Map<string, AgentConfig>();
  const entries = await fs.readdir(agentsDir, { withFileTypes: true });

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const dir = path.join(agentsDir, entry.name);
    try {
      const loaded = await loadAgent(dir);
      agents.set(loaded.id, loaded);
    } catch (err) {
      console.warn(`Skipping invalid agent directory ${entry.name}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  return agents;
}

async function fileExists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

async function dirHasFiles(dir: string, ...extensions: string[]): Promise<boolean> {
  try {
    const files = await fs.readdir(dir);
    return files.some((f) => extensions.some((ext) => f.toLowerCase().endsWith(ext)));
  } catch {
    return false;
  }
}
