import { createBlockEngine } from "./block.js";
import type { DAGDef } from "./block.js";

function toBlockId(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 24) || "task";
}

function codingDraft(goal: string): Record<string, unknown> {
  return {
    name: `autopilot-${toBlockId(goal)}`,
    blocks: [
      {
        id: "plan",
        name: "Plan",
        inputs: { prompt: "string" },
        outputs: { plan: "string" },
        agent: { role: "manager" },
        pre_gates: [],
        post_gates: [
          { name: "plan-not-empty", check: { type: "port_not_empty", port: "plan" }, error: "Plan is required" },
        ],
        retry: { max_attempts: 0, backoff: "none", delay_ms: 0 },
      },
      {
        id: "implement",
        name: "Implement",
        inputs: { plan: "string" },
        outputs: { draft: "string" },
        agent: { role: "worker", capability: "coding" },
        pre_gates: [],
        post_gates: [
          {
            name: "quality-review",
            check: {
              type: "llm_review",
              port: "draft",
              criteria: [
                "Includes concrete implementation steps",
                "Mentions tests or validation strategy",
              ],
              pass_threshold: 1,
              timeout_ms: 15000,
            },
            error: "Implementation draft did not pass semantic quality review",
          },
        ],
        retry: { max_attempts: 1, backoff: "linear", delay_ms: 1000 },
      },
      {
        id: "review",
        name: "Review",
        inputs: { draft: "string" },
        outputs: { approved: "boolean", notes: "string" },
        agent: { role: "reviewer" },
        pre_gates: [],
        post_gates: [
          { name: "approved-type", check: { type: "port_type", port: "approved", expected: "boolean" }, error: "Review must return approved boolean" },
        ],
        retry: { max_attempts: 0, backoff: "none", delay_ms: 0 },
      },
    ],
    edges: [
      { from: "plan", output: "plan", to: "implement", input: "plan" },
      { from: "implement", output: "draft", to: "review", input: "draft" },
    ],
  };
}

function researchDraft(goal: string): Record<string, unknown> {
  return {
    name: `autopilot-${toBlockId(goal)}`,
    blocks: [
      {
        id: "gather",
        name: "Gather",
        inputs: { prompt: "string" },
        outputs: { findings: "string", sources: "json" },
        agent: { role: "worker", capability: "research" },
        pre_gates: [],
        post_gates: [
          { name: "has-findings", check: { type: "port_not_empty", port: "findings" }, error: "Findings are required" },
        ],
        retry: { max_attempts: 1, backoff: "none", delay_ms: 0 },
      },
      {
        id: "synthesize",
        name: "Synthesize",
        inputs: { findings: "string", sources: "json" },
        outputs: { summary: "string" },
        agent: { role: "worker", capability: "research" },
        pre_gates: [],
        post_gates: [
          {
            name: "research-review",
            check: {
              type: "llm_review",
              port: "summary",
              criteria: ["Claims are evidence-backed", "Summary is concise and clear"],
              pass_threshold: 1,
              timeout_ms: 15000,
            },
            error: "Summary failed semantic review",
          },
        ],
        retry: { max_attempts: 0, backoff: "none", delay_ms: 0 },
      },
    ],
    edges: [
      { from: "gather", output: "findings", to: "synthesize", input: "findings" },
      { from: "gather", output: "sources", to: "synthesize", input: "sources" },
    ],
  };
}

export function draftDagFromGoal(goal: string): Record<string, unknown> {
  const g = goal.toLowerCase();
  if (g.includes("research") || g.includes("analyze") || g.includes("brief")) {
    return researchDraft(goal);
  }
  return codingDraft(goal);
}

export function planDagWithRetry(
  goal: string,
  planAttempt: (goal: string, attempt: number, previousError?: string) => Record<string, unknown>,
  maxAttempts = 2,
): DAGDef {
  const engine = createBlockEngine();
  let lastError = "";

  for (let i = 1; i <= maxAttempts; i++) {
    const candidate = planAttempt(goal, i, lastError || undefined);
    try {
      return engine.parseDAG(candidate as Record<string, unknown>);
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
    }
  }

  throw new Error(`autopilot planner failed after ${maxAttempts} attempts: ${lastError}`);
}

export function planDagFromGoal(goal: string): DAGDef {
  return planDagWithRetry(goal, (g) => draftDagFromGoal(g), 2);
}
