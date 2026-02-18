import { execSync } from "node:child_process";
import type { BlockGate, GateResult } from "./block-types.js";
import { evaluateSafeExpression } from "./expression-eval.js";

export function evaluateBlockGate(
  gate: BlockGate,
  inputs: Record<string, unknown>,
  outputs: Record<string, unknown>
): GateResult {
  const ports = { ...inputs, ...outputs };

  switch (gate.check.type) {
    case "port_not_empty": {
      const val = ports[gate.check.port];
      if (val === undefined || val === null || String(val).trim() === "") {
        return { name: gate.name, passed: false, reason: gate.error };
      }
      return { name: gate.name, passed: true };
    }

    case "port_matches": {
      const val = String(ports[gate.check.port] ?? "");
      if (!new RegExp(gate.check.pattern).test(val)) {
        return { name: gate.name, passed: false, reason: gate.error };
      }
      return { name: gate.name, passed: true };
    }

    case "port_min_length": {
      const val = String(ports[gate.check.port] ?? "");
      if (val.length < gate.check.min) {
        return { name: gate.name, passed: false, reason: gate.error };
      }
      return { name: gate.name, passed: true };
    }

    case "port_type": {
      const val = ports[gate.check.port];
      const actual = typeof val;
      if (actual !== gate.check.expected) {
        return { name: gate.name, passed: false, reason: `Expected ${gate.check.expected}, got ${actual}` };
      }
      return { name: gate.name, passed: true };
    }

    case "json_schema": {
      const val = ports[gate.check.port];
      const check = validateSimpleJsonSchema(val, gate.check.schema);
      if (!check.ok) {
        return { name: gate.name, passed: false, reason: `${gate.error} (${check.error})` };
      }
      return { name: gate.name, passed: true, audit: { gate_type: "json_schema" } };
    }

    case "http": {
      const probe = evaluateHttpGate(gate.check);
      if (!probe.ok) {
        return {
          name: gate.name,
          passed: false,
          reason: `${gate.error} (${probe.error})`,
          audit: { gate_type: "http", ...(probe.audit ?? {}) },
        };
      }
      return { name: gate.name, passed: true, audit: { gate_type: "http", ...(probe.audit ?? {}) } };
    }

    case "semantic_review": {
      const text = String(ports[gate.check.port] ?? "").toLowerCase();
      const keywords = gate.check.keywords.map((k) => k.toLowerCase());
      const matched = keywords.filter((k) => text.includes(k));
      const minMatches = gate.check.min_matches ?? 1;
      if (matched.length < minMatches) {
        return {
          name: gate.name,
          passed: false,
          reason: `${gate.error} (matched ${matched.length}/${minMatches})`,
          audit: { gate_type: "semantic_review", matched, required: minMatches },
        };
      }
      return { name: gate.name, passed: true, audit: { gate_type: "semantic_review", matched, required: minMatches } };
    }

    case "llm_review": {
      return {
        name: gate.name,
        passed: false,
        reason: `${gate.error} (llm_review requires executor evaluation path)`,
        audit: { gate_type: "llm_review", status: "deferred" },
      };
    }

    case "diff": {
      const leftVal = ports[gate.check.left];
      const rightVal = ports[gate.check.right];
      const left = stableStringify(leftVal);
      const right = stableStringify(rightVal);
      const mode = gate.check.mode ?? "equal";
      const ok = mode === "equal" ? left === right : left !== right;
      if (!ok) {
        return {
          name: gate.name,
          passed: false,
          reason: `${gate.error} (diff ${mode} check failed for '${gate.check.left}' vs '${gate.check.right}')`,
          audit: { gate_type: "diff", mode },
        };
      }
      return { name: gate.name, passed: true, audit: { gate_type: "diff", mode } };
    }

    case "cost": {
      const port = gate.check.port ?? "__cost";
      const value = Number(ports[port] ?? 0);
      if (!Number.isFinite(value)) {
        return { name: gate.name, passed: false, reason: `${gate.error} (invalid cost value)` };
      }
      if (value > gate.check.max) {
        return { name: gate.name, passed: false, reason: `${gate.error} (cost ${value} > ${gate.check.max})` };
      }
      return { name: gate.name, passed: true, audit: { gate_type: "cost", value, max: gate.check.max, port } };
    }

    case "latency": {
      const port = gate.check.port ?? "__latency_ms";
      const value = Number(ports[port] ?? 0);
      if (!Number.isFinite(value)) {
        return { name: gate.name, passed: false, reason: `${gate.error} (invalid latency value)` };
      }
      if (value > gate.check.max_ms) {
        return { name: gate.name, passed: false, reason: `${gate.error} (latency ${value}ms > ${gate.check.max_ms}ms)` };
      }
      return { name: gate.name, passed: true, audit: { gate_type: "latency", value_ms: value, max_ms: gate.check.max_ms, port } };
    }

    case "shell": {
      const allowShellGates = isShellGateEnabled();
      if (!allowShellGates) {
        return {
          name: gate.name,
          passed: false,
          reason: `${gate.error} (shell gates disabled; set OPENSKELO_ALLOW_SHELL_GATES=true to enable)`,
          audit: {
            gate_type: "shell",
            command: gate.check.command,
            enabled: false,
            status: "blocked",
          },
        };
      }

      const timeoutMs = Number(process.env.OPENSKELO_SHELL_GATE_TIMEOUT_MS ?? "10000");
      const started = Date.now();
      try {
        execSync(gate.check.command, { timeout: timeoutMs, stdio: "pipe", env: process.env });
        const durationMs = Date.now() - started;
        return {
          name: gate.name,
          passed: true,
          audit: {
            gate_type: "shell",
            command: gate.check.command,
            enabled: true,
            timeout_ms: timeoutMs,
            duration_ms: durationMs,
            status: "passed",
          },
        };
      } catch (err) {
        const durationMs = Date.now() - started;
        const shellErr = err as { status?: number; signal?: string; message?: string };
        return {
          name: gate.name,
          passed: false,
          reason: `${gate.error} (${shellErr.message ?? "shell execution failed"})`,
          audit: {
            gate_type: "shell",
            command: gate.check.command,
            enabled: true,
            timeout_ms: timeoutMs,
            duration_ms: durationMs,
            status: "failed",
            exit_code: shellErr.status,
            signal: shellErr.signal,
            error: shellErr.message,
          },
        };
      }
    }

    case "expr": {
      try {
        const result = evaluateSafeExpression(gate.check.expression, { inputs, outputs });
        return { name: gate.name, passed: !!result };
      } catch (err) {
        return { name: gate.name, passed: false, reason: `Expression error: ${(err as Error).message}` };
      }
    }

    default:
      return { name: gate.name, passed: false, reason: "Unknown gate check type" };
  }
}

function evaluateHttpGate(check: { url: string; method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE"; expect_status?: number; timeout_ms?: number }): { ok: boolean; error?: string; audit?: Record<string, unknown> } {
  // Deterministic mock path for local/offline testing.
  const mock = check.url.match(/^mock:\/\/status\/(\d{3})$/);
  if (mock) {
    const status = Number(mock[1]);
    const expectStatus = Number(check.expect_status ?? 200);
    return {
      ok: status === expectStatus,
      error: status === expectStatus ? undefined : `expected status ${expectStatus}, got ${status}`,
      audit: { url: check.url, method: check.method ?? "GET", status, expect_status: expectStatus, mock: true },
    };
  }

  const timeoutMs = Number(check.timeout_ms ?? 5000);
  const expectStatus = Number(check.expect_status ?? 200);
  try {
    const cmd = `curl -s -o /dev/null -w "%{http_code}" --max-time ${Math.ceil(timeoutMs / 1000)} -X ${check.method ?? "GET"} ${JSON.stringify(check.url)}`;
    const out = String(execSync(cmd, { stdio: ["ignore", "pipe", "pipe"] })).trim();
    const status = Number(out);
    return {
      ok: status === expectStatus,
      error: status === expectStatus ? undefined : `expected status ${expectStatus}, got ${status}`,
      audit: { url: check.url, method: check.method ?? "GET", status, expect_status: expectStatus, timeout_ms: timeoutMs },
    };
  } catch (err) {
    return { ok: false, error: (err as Error).message, audit: { url: check.url, method: check.method ?? "GET", timeout_ms: timeoutMs } };
  }
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((v) => stableStringify(v)).join(",")}]`;
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`).join(",")}}`;
}

function validateSimpleJsonSchema(value: unknown, schema: Record<string, unknown>): { ok: boolean; error?: string } {
  const expectedType = String(schema.type ?? "").trim();

  if (expectedType === "object") {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      return { ok: false, error: "expected object" };
    }

    const required = Array.isArray(schema.required) ? schema.required.map(String) : [];
    for (const key of required) {
      if (!(key in (value as Record<string, unknown>))) {
        return { ok: false, error: `missing required key '${key}'` };
      }
    }

    const properties = (schema.properties && typeof schema.properties === "object")
      ? (schema.properties as Record<string, Record<string, unknown>>)
      : {};

    for (const [key, propSchema] of Object.entries(properties)) {
      if (!(key in (value as Record<string, unknown>))) continue;
      const propVal = (value as Record<string, unknown>)[key];
      const propType = String(propSchema.type ?? "").trim();
      if (!propType) continue;
      const actual = Array.isArray(propVal) ? "array" : typeof propVal;
      if (actual !== propType) {
        return { ok: false, error: `property '${key}' expected ${propType}, got ${actual}` };
      }
    }

    return { ok: true };
  }

  if (expectedType) {
    const actual = Array.isArray(value) ? "array" : typeof value;
    if (actual !== expectedType) {
      return { ok: false, error: `expected ${expectedType}, got ${actual}` };
    }
  }

  return { ok: true };
}

function isShellGateEnabled(): boolean {
  const raw = String(process.env.OPENSKELO_ALLOW_SHELL_GATES ?? "").trim().toLowerCase();
  return raw === "1" || raw === "true" || raw === "yes" || raw === "on";
}
