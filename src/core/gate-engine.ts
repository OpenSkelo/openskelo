import { execSync } from "child_process";
import type { Gate, GateCheck, GateResult, Task } from "../types.js";

export function createGateEngine(gates: Gate[]) {
  /**
   * Evaluate all applicable gates for a status transition.
   * Returns array of results. If any fail, the transition should be rejected.
   */
  function evaluate(
    task: Task,
    fromStatus: string | null,
    toStatus: string,
    updates: Partial<Task>,
    agentRole?: string
  ): GateResult[] {
    const applicable = gates.filter((gate) => {
      // Match transition
      if (gate.on.to !== toStatus && gate.on.to !== "*") return false;
      if (gate.on.from && gate.on.from !== fromStatus && gate.on.from !== "*") return false;
      if (gate.on.pipeline && gate.on.pipeline !== task.pipeline) return false;
      return true;
    });

    return applicable.map((gate) => {
      // Check bypass
      if (agentRole && gate.bypass?.includes(agentRole)) {
        return { name: gate.name, result: "pass" as const, reason: "bypassed" };
      }

      return runCheck(gate, task, updates);
    });
  }

  function hasFailed(results: GateResult[]): GateResult | null {
    return results.find((r) => r.result === "fail") ?? null;
  }

  return { evaluate, hasFailed };
}

function runCheck(gate: Gate, task: Task, updates: Partial<Task>): GateResult {
  const check = gate.check;
  const merged = { ...task, ...updates };

  try {
    switch (check.type) {
      case "not_empty": {
        const value = getField(merged, check.field);
        if (!value || String(value).trim() === "") {
          return { name: gate.name, result: "fail", reason: `${check.field} is empty` };
        }
        return { name: gate.name, result: "pass" };
      }

      case "contains": {
        const value = String(getField(merged, check.field) ?? "").toUpperCase();
        const missing = check.values.filter((v) => !value.includes(v.toUpperCase()));
        if (missing.length > 0) {
          return {
            name: gate.name,
            result: "fail",
            reason: `${check.field} missing: ${missing.join(", ")}`,
          };
        }
        return { name: gate.name, result: "pass" };
      }

      case "matches": {
        const value = String(getField(merged, check.field) ?? "");
        const regex = new RegExp(check.pattern);
        if (!regex.test(value)) {
          return {
            name: gate.name,
            result: "fail",
            reason: `${check.field} doesn't match pattern: ${check.pattern}`,
          };
        }
        return { name: gate.name, result: "pass" };
      }

      case "min_length": {
        const value = String(getField(merged, check.field) ?? "");
        if (value.length < check.min) {
          return {
            name: gate.name,
            result: "fail",
            reason: `${check.field} too short (${value.length}/${check.min})`,
          };
        }
        return { name: gate.name, result: "pass" };
      }

      case "max_value": {
        const value = Number(getField(merged, check.field) ?? 0);
        if (value > check.max) {
          return {
            name: gate.name,
            result: "fail",
            reason: `${check.field} exceeds max (${value}/${check.max})`,
          };
        }
        return { name: gate.name, result: "pass" };
      }

      case "valid_json": {
        const value = String(getField(merged, check.field) ?? "");
        try {
          JSON.parse(value);
          return { name: gate.name, result: "pass" };
        } catch {
          return { name: gate.name, result: "fail", reason: `${check.field} is not valid JSON` };
        }
      }

      case "valid_url": {
        const value = String(getField(merged, check.field) ?? "");
        try {
          new URL(value);
          return { name: gate.name, result: "pass" };
        } catch {
          return { name: gate.name, result: "fail", reason: `${check.field} is not a valid URL` };
        }
      }

      case "shell": {
        const command = check.command
          .replace(/\{\{task_id\}\}/g, task.id)
          .replace(/\{\{status\}\}/g, task.status)
          .replace(/\{\{assigned\}\}/g, task.assigned);
        try {
          execSync(command, { timeout: 10000, stdio: "pipe" });
          return { name: gate.name, result: "pass" };
        } catch {
          return { name: gate.name, result: "fail", reason: `shell check failed: ${check.command}` };
        }
      }

      default:
        return { name: gate.name, result: "fail", reason: `Unknown check type` };
    }
  } catch (err) {
    return {
      name: gate.name,
      result: "fail",
      reason: `Gate error: ${err instanceof Error ? err.message : "unknown"}`,
    };
  }
}

function getField(obj: Record<string, unknown>, field: string): unknown {
  // Support dot notation for metadata fields: "metadata.sources"
  const parts = field.split(".");
  let current: unknown = obj;
  for (const part of parts) {
    if (current == null || typeof current !== "object") return undefined;
    current = (current as Record<string, unknown>)[part];
    // If the field is "metadata" and it's a string, parse it
    if (part === "metadata" && typeof current === "string") {
      try { current = JSON.parse(current); } catch { return undefined; }
    }
  }
  return current;
}
