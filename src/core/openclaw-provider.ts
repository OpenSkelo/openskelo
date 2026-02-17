/**
 * OpenClaw Provider — dispatches blocks to real OpenClaw agents
 * via sessions_spawn / CLI agent command.
 *
 * Maps block agent roles to OpenClaw agent IDs:
 * - manager → main (Nora)
 * - worker → rei (Tech Lead)
 * - reviewer → mari (QA)
 * - specialist → rei (fallback)
 */

import { execSync } from "node:child_process";
import type { ProviderAdapter, DispatchRequest, DispatchResult } from "../types.js";

export interface OpenClawProviderOpts {
  /** Map of role → OpenClaw agent ID */
  agentMapping?: Record<string, string>;
  /** Timeout per block in seconds (default: 120) */
  timeoutSeconds?: number;
  /** Model override (e.g., "minimax/MiniMax-M2.5") */
  model?: string;
  /** Thinking level */
  thinking?: string;
}

const DEFAULT_AGENT_MAP: Record<string, string> = {
  manager: "main",
  worker: "rei",
  reviewer: "mari",
  specialist: "rei",
};

export function createOpenClawProvider(opts: OpenClawProviderOpts = {}): ProviderAdapter {
  const agentMap = { ...DEFAULT_AGENT_MAP, ...opts.agentMapping };
  const timeout = opts.timeoutSeconds ?? 120;

  return {
    name: "openclaw",
    type: "openclaw",

    async dispatch(request: DispatchRequest): Promise<DispatchResult> {
      const agentId = resolveAgent(request, agentMap);
      const startTime = Date.now();

      // Build the prompt for the agent
      const prompt = buildAgentPrompt(request);

      try {
        // Use openclaw agent CLI to dispatch
        const args: string[] = [
          "openclaw", "agent",
          "--agent", agentId,
          "--message", prompt,
          "--json",
          "--timeout", String(timeout),
        ];

        if (opts.thinking) {
          args.push("--thinking", opts.thinking);
        }

        const result = execSync(args.join(" "), {
          timeout: (timeout + 10) * 1000,
          encoding: "utf-8",
          stdio: ["pipe", "pipe", "pipe"],
          env: { ...process.env },
        });

        // Parse JSON response
        const parsed = tryParseJSON(result);
        const durationMs = Date.now() - startTime;

        if (parsed && parsed.reply) {
          return {
            success: true,
            output: parsed.reply,
            sessionId: parsed.sessionKey ?? parsed.sessionId ?? `oc_${Date.now()}`,
            tokensUsed: parsed.usage?.totalTokens ?? 0,
          };
        }

        // Fallback: treat entire stdout as output
        return {
          success: true,
          output: result.trim(),
          sessionId: `oc_${Date.now()}`,
          tokensUsed: 0,
        };

      } catch (err) {
        const error = err instanceof Error ? err.message : "Unknown dispatch error";
        return {
          success: false,
          error: `OpenClaw agent '${agentId}' failed: ${error.slice(0, 200)}`,
        };
      }
    },

    async healthCheck(): Promise<boolean> {
      try {
        const result = execSync("openclaw status --json", {
          timeout: 5000,
          encoding: "utf-8",
          stdio: ["pipe", "pipe", "pipe"],
        });
        return result.includes("ok") || result.includes("running");
      } catch {
        return false;
      }
    },
  };
}

function resolveAgent(request: DispatchRequest, agentMap: Record<string, string>): string {
  // Try specific agent ID first
  if (request.agent?.id && agentMap[request.agent.id]) {
    return agentMap[request.agent.id];
  }

  // Try role mapping
  if (request.agent?.role && agentMap[request.agent.role]) {
    return agentMap[request.agent.role];
  }

  // Fallback to worker
  return agentMap.worker ?? "rei";
}

function buildAgentPrompt(request: DispatchRequest): string {
  const lines: string[] = [];

  lines.push(`You are executing a block in an OpenSkelo DAG pipeline.`);
  lines.push(`Block: ${request.title}`);
  lines.push(`Pipeline: ${request.pipeline}`);
  lines.push("");
  lines.push("## Task");
  lines.push(request.description);
  lines.push("");

  if (request.context && Object.keys(request.context).length > 0) {
    lines.push("## Input Data");
    for (const [key, value] of Object.entries(request.context)) {
      const val = typeof value === "string" ? value : JSON.stringify(value);
      lines.push(`- **${key}**: ${val.length > 200 ? val.slice(0, 200) + "..." : val}`);
    }
    lines.push("");
  }

  if (request.acceptanceCriteria && request.acceptanceCriteria.length > 0) {
    lines.push("## Quality Criteria");
    for (const criteria of request.acceptanceCriteria) {
      lines.push(`- ${criteria}`);
    }
    lines.push("");
  }

  lines.push("## Response Format");
  lines.push("Respond with a JSON object containing your outputs. Wrap it in ```json code fences.");
  lines.push("Each key should match the expected output port names from the block definition.");

  if (request.bounceCount > 0) {
    lines.push("");
    lines.push(`⚠️ This is retry attempt ${request.bounceCount + 1}. Previous attempt failed.`);
    if (request.previousNotes) {
      lines.push(`Previous feedback: ${request.previousNotes}`);
    }
  }

  return lines.join("\n");
}

function tryParseJSON(str: string): Record<string, unknown> | null {
  // Try to find JSON in the output (may have other text around it)
  const trimmed = str.trim();

  // Direct parse
  try {
    return JSON.parse(trimmed);
  } catch { /* not pure JSON */ }

  // Find last JSON object in output
  const jsonMatch = trimmed.match(/\{[\s\S]*\}$/);
  if (jsonMatch) {
    try {
      return JSON.parse(jsonMatch[0]);
    } catch { /* not valid */ }
  }

  return null;
}
