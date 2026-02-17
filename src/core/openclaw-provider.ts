/**
 * OpenClaw Provider — dispatches blocks to OpenClaw agents
 * via the openclaw agent CLI (async, non-blocking).
 *
 * Role mapping is configurable (agentMapping).
 * Defaults are generic role-name mappings.
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
  manager: "manager",
  worker: "worker",
  reviewer: "reviewer",
  specialist: "specialist",
};

export function createOpenClawProvider(opts: OpenClawProviderOpts = {}): ProviderAdapter {
  const agentMap = { ...DEFAULT_AGENT_MAP, ...opts.agentMapping };
  const timeout = opts.timeoutSeconds ?? 300;

  return {
    name: "openclaw",
    type: "openclaw",

    async dispatch(request: DispatchRequest): Promise<DispatchResult> {
      const agentId = resolveAgent(request, agentMap);
      const prompt = buildAgentPrompt(request);

      console.log(`[openclaw-provider] Dispatching block "${request.title}" to agent '${agentId}'...`);

      try {
        const result = await runOpenClawAgent(agentId, prompt, timeout, opts, request.abortSignal);

        console.log(`[openclaw-provider] Agent '${agentId}' finished (exit: ${result.exitCode}, stdout: ${result.stdout.length} bytes, stderr: ${result.stderr.length} bytes)`);

        if (result.exitCode !== 0) {
          const unknownId = /Unknown agent id/i.test(result.stderr);
          if (unknownId && agentId !== "main") {
            console.warn(`[openclaw-provider] Unknown agent '${agentId}', retrying on fallback agent 'main'`);
            const retry = await runOpenClawAgent("main", prompt, timeout, opts, request.abortSignal);
            if (retry.exitCode === 0) {
              const parsedRetry = tryParseJSON(retry.stdout);
              const payloads = (parsedRetry?.result as Record<string, unknown> | undefined)?.payloads as Array<Record<string, unknown>> | undefined;
              const text = payloads?.[0]?.text as string | undefined;
              return {
                success: true,
                output: text ?? retry.stdout.trim(),
                sessionId: `oc_${Date.now()}`,
                tokensUsed: 0,
                actualAgentId: "main",
                actualModel: opts.model ?? request.agent.model,
              };
            }
          }

          console.error(`[openclaw-provider] Agent '${agentId}' FAILED:`, result.stderr.slice(0, 500));
          return {
            success: false,
            error: `Agent '${agentId}' exited with code ${result.exitCode}: ${result.stderr.slice(0, 200)}`,
          };
        }

        // Parse JSON response from openclaw agent --json
        const parsed = tryParseJSON(result.stdout);

        if (parsed) {
          // openclaw agent --json returns: { result: { payloads: [{ text }] }, runId, ... }
          const payloads = (parsed.result as Record<string, unknown>)?.payloads as Array<Record<string, unknown>> | undefined;
          const text = payloads?.[0]?.text as string | undefined;
          const runId = parsed.runId as string | undefined;
          const meta = (parsed.result as Record<string, unknown>)?.meta as Record<string, unknown> | undefined;
          const agentMeta = meta?.agentMeta as Record<string, unknown> | undefined;
          const usage = agentMeta?.usage as Record<string, number> | undefined;

          if (text) {
            const norm = await normalizeStructuredOutput(
              text,
              request.outputSchema,
              agentId,
              timeout,
              opts,
              request.abortSignal
            );
            return {
              success: true,
              output: norm.output,
              sessionId: (agentMeta?.sessionId as string) ?? runId ?? `oc_${Date.now()}`,
              tokensUsed: (usage?.input ?? 0) + (usage?.output ?? 0),
              actualAgentId: agentId,
              actualModel: opts.model ?? request.agent.model,
              repairAttempted: norm.repairAttempted,
              repairSucceeded: norm.repairSucceeded,
            };
          }

          // Fallback: try .reply (older format)
          if (parsed.reply) {
            const norm = await normalizeStructuredOutput(
              parsed.reply as string,
              request.outputSchema,
              agentId,
              timeout,
              opts,
              request.abortSignal
            );
            return {
              success: true,
              output: norm.output,
              sessionId: `oc_${Date.now()}`,
              tokensUsed: 0,
              actualAgentId: agentId,
              actualModel: opts.model ?? request.agent.model,
              repairAttempted: norm.repairAttempted,
              repairSucceeded: norm.repairSucceeded,
            };
          }
        }

        // Last fallback: use raw stdout
        const norm = await normalizeStructuredOutput(
          result.stdout.trim(),
          request.outputSchema,
          agentId,
          timeout,
          opts,
          request.abortSignal
        );
        return {
          success: true,
          output: norm.output,
          sessionId: `oc_${Date.now()}`,
          tokensUsed: 0,
          actualAgentId: agentId,
          actualModel: opts.model ?? request.agent.model,
          repairAttempted: norm.repairAttempted,
          repairSucceeded: norm.repairSucceeded,
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
  opts: OpenClawProviderOpts,
  abortSignal?: AbortSignal
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

  return runCommand("openclaw", args, timeoutSec + 10, abortSignal);
}

/**
 * Async wrapper around child_process.spawn.
 */
function runCommand(
  cmd: string,
  args: string[],
  timeoutSec: number,
  abortSignal?: AbortSignal
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, {
      env: { ...process.env },
      stdio: ["pipe", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";
    let settled = false;
    let timer: NodeJS.Timeout | undefined;

    const finishReject = (err: Error) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      if (abortSignal) abortSignal.removeEventListener("abort", onAbort);
      reject(err);
    };

    const finishResolve = (code: number | null) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      if (abortSignal) abortSignal.removeEventListener("abort", onAbort);
      resolve({ stdout, stderr, exitCode: code ?? 1 });
    };

    const onAbort = () => {
      try { child.kill("SIGKILL"); } catch { /* ignore */ }
      finishReject(new Error("Dispatch aborted by run stop"));
    };

    if (abortSignal?.aborted) {
      onAbort();
      return;
    }

    child.stdout.on("data", (chunk: Buffer) => { stdout += chunk.toString(); });
    child.stderr.on("data", (chunk: Buffer) => { stderr += chunk.toString(); });

    timer = setTimeout(() => {
      try { child.kill("SIGKILL"); } catch { /* ignore */ }
      finishReject(new Error(`Command timed out after ${timeoutSec}s`));
    }, timeoutSec * 1000);

    if (abortSignal) abortSignal.addEventListener("abort", onAbort, { once: true });

    child.on("close", (code: number | null) => {
      finishResolve(code);
    });

    child.on("error", (err: Error) => {
      finishReject(err);
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
  return agentMap.worker ?? "worker";
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
  lines.push("Respond with ONLY valid JSON (no markdown, no prose).");
  lines.push("Each key should match the expected output port names from the block definition.");

  if (request.outputSchema) {
    lines.push("");
    lines.push("## Output Schema (strict)");
    lines.push("Your JSON must satisfy this schema:");
    lines.push("```json");
    lines.push(JSON.stringify(request.outputSchema, null, 2));
    lines.push("```");
  }

  if (request.bounceCount > 0) {
    lines.push("");
    lines.push(`⚠️ This is retry attempt ${request.bounceCount + 1}. Previous attempt failed.`);
    if (request.previousNotes) {
      lines.push(`Previous feedback: ${request.previousNotes}`);
    }
  }

  return lines.join("\n");
}

async function normalizeStructuredOutput(
  text: string,
  schema: Record<string, unknown> | undefined,
  agentId: string,
  timeoutSec: number,
  opts: OpenClawProviderOpts,
  abortSignal?: AbortSignal
): Promise<{ output: string; repairAttempted: boolean; repairSucceeded: boolean }> {
  if (!schema) return { output: text, repairAttempted: false, repairSucceeded: false };

  const parsed = tryParseJSON(text);
  if (parsed && matchesSchema(parsed, schema)) {
    return { output: JSON.stringify(parsed), repairAttempted: false, repairSucceeded: false };
  }

  // Adapter-level schema repair pass (generic, one-shot)
  const repairPrompt = [
    "Convert the following content into valid JSON that matches the schema.",
    "Return ONLY JSON.",
    "Schema:",
    JSON.stringify(schema, null, 2),
    "Content:",
    text.slice(0, 3000),
  ].join("\n");

  try {
    const repaired = await runOpenClawAgent(agentId, repairPrompt, Math.max(20, Math.floor(timeoutSec / 2)), opts, abortSignal);
    if (repaired.exitCode === 0) {
      const parsedRepair = tryParseJSON(repaired.stdout);
      if (parsedRepair && matchesSchema(parsedRepair, schema)) {
        return { output: JSON.stringify(parsedRepair), repairAttempted: true, repairSucceeded: true };
      }
    }
  } catch {
    // best effort only; caller core contract validation still applies
  }

  return { output: text, repairAttempted: true, repairSucceeded: false };
}

function matchesSchema(value: Record<string, unknown>, schema: Record<string, unknown>): boolean {
  if (!schema || schema.type !== "object") return true;
  const required = Array.isArray(schema.required) ? schema.required as string[] : [];
  const properties = (schema.properties as Record<string, Record<string, unknown>> | undefined) ?? {};

  for (const key of required) {
    if (!(key in value)) return false;
    const expectedType = properties[key]?.type as string | undefined;
    if (!expectedType) continue;
    const actual = value[key];
    if (expectedType === "object" && (typeof actual !== "object" || actual === null)) return false;
    if (expectedType === "string" && typeof actual !== "string") return false;
    if (expectedType === "number" && typeof actual !== "number") return false;
    if (expectedType === "boolean" && typeof actual !== "boolean") return false;
  }

  if (schema.additionalProperties === false) {
    const allowed = new Set(Object.keys(properties));
    for (const key of Object.keys(value)) {
      if (!allowed.has(key)) return false;
    }
  }

  return true;
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
