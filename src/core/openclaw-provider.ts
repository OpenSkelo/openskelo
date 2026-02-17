/**
 * OpenClaw Provider — dispatches blocks to real OpenClaw agents
 * via the openclaw agent CLI (async, non-blocking).
 *
 * Maps block agent roles to OpenClaw agent IDs:
 * - manager → main (Nora)
 * - worker → rei (Tech Lead)  
 * - reviewer → mari (QA)
 * - specialist → rei (fallback)
 */

import { spawn } from "node:child_process";
import type { ProviderAdapter, DispatchRequest, DispatchResult } from "../types.js";

export interface OpenClawProviderOpts {
  /** Map of role → OpenClaw agent ID */
  agentMapping?: Record<string, string>;
  /** Timeout per block in seconds (default: 120) */
  timeoutSeconds?: number;
  /** Model override */
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
      const prompt = buildAgentPrompt(request);

      try {
        const result = await runOpenClawAgent(agentId, prompt, timeout, opts);

        if (result.exitCode !== 0) {
          return {
            success: false,
            error: `Agent '${agentId}' exited with code ${result.exitCode}: ${result.stderr.slice(0, 200)}`,
          };
        }

        // Parse JSON response
        const parsed = tryParseJSON(result.stdout);

        if (parsed && parsed.reply) {
          return {
            success: true,
            output: parsed.reply as string,
            sessionId: (parsed.sessionKey ?? parsed.sessionId ?? `oc_${Date.now()}`) as string,
            tokensUsed: (parsed.usage as Record<string, number>)?.totalTokens ?? 0,
          };
        }

        // Fallback: use raw stdout
        return {
          success: true,
          output: result.stdout.trim(),
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
        const result = await runCommand("openclaw", ["status", "--json"], 5);
        return result.stdout.includes("ok") || result.stdout.includes("running");
      } catch {
        return false;
      }
    },
  };
}

/**
 * Run openclaw agent command asynchronously (non-blocking).
 */
function runOpenClawAgent(
  agentId: string,
  prompt: string,
  timeoutSec: number,
  opts: OpenClawProviderOpts
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  const args = [
    "agent",
    "--agent", agentId,
    "--message", prompt,
    "--json",
    "--timeout", String(timeoutSec),
  ];

  if (opts.thinking) {
    args.push("--thinking", opts.thinking);
  }

  return runCommand("openclaw", args, timeoutSec + 10);
}

/**
 * Async wrapper around child_process.spawn.
 */
function runCommand(
  cmd: string,
  args: string[],
  timeoutSec: number
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, {
      env: { ...process.env },
      stdio: ["pipe", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";
    let killed = false;

    child.stdout.on("data", (chunk: Buffer) => { stdout += chunk.toString(); });
    child.stderr.on("data", (chunk: Buffer) => { stderr += chunk.toString(); });

    const timer = setTimeout(() => {
      killed = true;
      child.kill("SIGKILL");
      reject(new Error(`Command timed out after ${timeoutSec}s`));
    }, timeoutSec * 1000);

    child.on("close", (code: number | null) => {
      clearTimeout(timer);
      if (!killed) {
        resolve({ stdout, stderr, exitCode: code ?? 1 });
      }
    });

    child.on("error", (err: Error) => {
      clearTimeout(timer);
      reject(err);
    });
  });
}

function resolveAgent(request: DispatchRequest, agentMap: Record<string, string>): string {
  if (request.agent?.id && agentMap[request.agent.id]) {
    return agentMap[request.agent.id];
  }
  if (request.agent?.role && agentMap[request.agent.role]) {
    return agentMap[request.agent.role];
  }
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
  const trimmed = str.trim();
  try { return JSON.parse(trimmed); } catch { /* not pure JSON */ }

  const jsonMatch = trimmed.match(/\{[\s\S]*\}$/);
  if (jsonMatch) {
    try { return JSON.parse(jsonMatch[0]); } catch { /* not valid */ }
  }

  return null;
}
