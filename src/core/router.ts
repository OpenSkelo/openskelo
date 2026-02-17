import type { Agent, Pipeline, Stage } from "../types.js";
import { getDB } from "./db.js";

export function createRouter(
  agents: Record<string, Agent>,
  pipelines: Record<string, Pipeline>
) {
  /**
   * Find the right agent for a pipeline stage.
   * Matches by role + capability, excludes busy agents and the submitting agent.
   */
  function findAgent(
    pipeline: string,
    stage: string,
    excludeAgent?: string
  ): { agentId: string; agent: Agent } | null {
    const pipelineDef = pipelines[pipeline];
    if (!pipelineDef) return null;

    const stageDef = pipelineDef.stages.find((s) => s.name === stage);
    if (!stageDef?.route) return null;

    const { role, capability, specific } = stageDef.route;

    // Specific agent override
    if (specific) {
      const agent = agents[specific];
      if (agent) return { agentId: specific, agent };
      return null;
    }

    // Find by role + capability
    const candidates = Object.entries(agents).filter(([id, agent]) => {
      if (agent.role !== role) return false;
      if (capability && !agent.capabilities.includes(capability)) return false;
      if (id === excludeAgent) return false;
      return true;
    });

    if (candidates.length === 0) return null;

    // Pick by least load (check agent status in DB)
    const db = getDB();
    let bestId = candidates[0][0];
    let bestLoad = Infinity;

    for (const [id] of candidates) {
      const row = db.prepare(
        "SELECT COUNT(*) as count FROM tasks WHERE assigned LIKE ? AND status = 'IN_PROGRESS'"
      ).get(`%${id}%`) as { count: number };

      const load = row?.count ?? 0;
      const maxConcurrent = agents[id].max_concurrent ?? 1;

      // Skip overloaded agents
      if (load >= maxConcurrent) continue;

      if (load < bestLoad) {
        bestLoad = load;
        bestId = id;
      }
    }

    return { agentId: bestId, agent: agents[bestId] };
  }

  /**
   * Get the stage definition for a status in a pipeline.
   */
  function getStage(pipeline: string, status: string): Stage | null {
    return pipelines[pipeline]?.stages.find((s) => s.name === status) ?? null;
  }

  return { findAgent, getStage };
}
