import { describe, it, expect, vi, beforeEach } from "vitest";
import { EventEmitter } from "node:events";
import type { DispatchRequest } from "../src/types.js";

interface SpawnPlan {
  stdout?: string;
  stderr?: string;
  exitCode?: number | null;
  error?: Error;
  neverClose?: boolean;
}

const spawnPlans: SpawnPlan[] = [];
const spawnCalls: Array<{ cmd: string; args: string[] }> = [];

vi.mock("node:child_process", () => {
  function spawn(_cmd: string, _args: string[]) {
    spawnCalls.push({ cmd: _cmd, args: _args });
    const plan = spawnPlans.shift() ?? { stdout: "", stderr: "", exitCode: 0 };
    const child = new EventEmitter() as EventEmitter & {
      stdout: EventEmitter;
      stderr: EventEmitter;
      kill: (sig?: string) => void;
    };

    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    child.kill = () => {
      if (plan.neverClose) {
        setTimeout(() => child.emit("close", 1), 0);
      }
    };

    setTimeout(() => {
      if (plan.error) {
        child.emit("error", plan.error);
        return;
      }
      if (plan.stdout) child.stdout.emit("data", Buffer.from(plan.stdout));
      if (plan.stderr) child.stderr.emit("data", Buffer.from(plan.stderr));
      if (!plan.neverClose) child.emit("close", plan.exitCode ?? 0);
    }, 0);

    return child;
  }

  return { spawn };
});

import { createOpenClawProvider } from "../src/core/openclaw-provider.js";

function baseRequest(): DispatchRequest {
  return {
    taskId: "t1",
    pipeline: "p1",
    title: "Do thing",
    description: "Return JSON",
    context: { prompt: "hello" },
    acceptanceCriteria: ["valid JSON"],
    bounceCount: 0,
    agent: { id: "main", role: "worker", model: "claude-opus-4-6" },
  };
}

describe("openclaw provider", () => {
  beforeEach(() => {
    spawnPlans.length = 0;
    spawnCalls.length = 0;
    vi.restoreAllMocks();
  });

  it("returns success for valid JSON payload", async () => {
    spawnPlans.push({
      stdout: JSON.stringify({
        runId: "run-1",
        result: {
          payloads: [{ text: '{"result":"ok"}' }],
          meta: { agentMeta: { usage: { input: 3, output: 2 }, sessionId: "s1", model: "claude-opus-4-6" } },
        },
      }),
      exitCode: 0,
    });

    const provider = createOpenClawProvider();
    const res = await provider.dispatch(baseRequest());

    expect(res.success).toBe(true);
    expect(res.output).toBe('{"result":"ok"}');
    expect(res.tokensUsed).toBe(5);
    expect(res.actualProvider).toBe("openclaw");
  });

  it("falls back to main on unknown agent id", async () => {
    const req = baseRequest();
    req.agent.id = "nonexistent";
    req.agent.role = "unknown";

    spawnPlans.push({ stderr: "Unknown agent id: nonexistent", exitCode: 2 });
    spawnPlans.push({
      stdout: JSON.stringify({
        result: { payloads: [{ text: '{"fixed":true}' }] },
      }),
      exitCode: 0,
    });

    const provider = createOpenClawProvider();
    const res = await provider.dispatch(req);

    expect(res.success).toBe(true);
    expect(res.actualAgentId).toBe("main");
    expect(res.output).toContain("fixed");
  });

  it("returns failure when process exits non-zero", async () => {
    spawnPlans.push({ stderr: "fatal error", exitCode: 1 });

    const provider = createOpenClawProvider();
    const res = await provider.dispatch(baseRequest());

    expect(res.success).toBe(false);
    expect(res.error).toContain("exited with code 1");
  });

  it("returns failure on spawn error", async () => {
    spawnPlans.push({ error: new Error("spawn ENOENT") });

    const provider = createOpenClawProvider();
    const res = await provider.dispatch(baseRequest());

    expect(res.success).toBe(false);
    expect(res.error).toContain("spawn ENOENT");
  });

  it("fails cleanly on timeout", async () => {
    vi.useFakeTimers();
    spawnPlans.push({ neverClose: true });

    const provider = createOpenClawProvider({ timeoutSeconds: 1 });
    const p = provider.dispatch(baseRequest());

    await vi.advanceTimersByTimeAsync(12_000);
    const res = await p;

    expect(res.success).toBe(false);
    expect(res.error).toContain("timed out");
    vi.useRealTimers();
  });

  it("injects request.system into prompt sent to openclaw", async () => {
    spawnPlans.push({
      stdout: JSON.stringify({
        runId: "run-1",
        result: { payloads: [{ text: '{"result":"ok"}' }] },
      }),
      exitCode: 0,
    });

    const req = baseRequest();
    req.system = "ROLE: You are a strict analyst.";

    const provider = createOpenClawProvider();
    const res = await provider.dispatch(req);

    expect(res.success).toBe(true);
    const messageArgIndex = spawnCalls[0].args.indexOf("--message");
    expect(messageArgIndex).toBeGreaterThan(-1);
    const prompt = spawnCalls[0].args[messageArgIndex + 1];
    expect(prompt).toContain("## System Context");
    expect(prompt).toContain("ROLE: You are a strict analyst.");
  });

  it("healthCheck returns true on running status output", async () => {
    spawnPlans.push({ stdout: '{"status":"running"}', exitCode: 0 });

    const provider = createOpenClawProvider();
    const ok = await provider.healthCheck?.();

    expect(ok).toBe(true);
  });
});
