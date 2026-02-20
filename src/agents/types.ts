import type { AgentYaml } from "./schema.js";

export interface AgentConfig extends AgentYaml {
  dir: string;
  hasRole: boolean;
  hasTask: boolean;
  hasRules: boolean;
  hasSkills: boolean;
  hasContext: boolean;
  hasMcp: boolean;
  hasMemory: boolean;
  hasPolicies: boolean;
  hasProcedural: boolean;
}
