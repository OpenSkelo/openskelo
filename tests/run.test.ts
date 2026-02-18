import { describe, it, expect, vi, beforeEach } from "vitest";
import { Command } from "commander";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runCommands } from "../src/commands/run.js";

function withTempDir(): string {
  return mkdtempSync(join(tmpdir(), "skelo-run-test-"));
}

function installExitThrow() {
  vi.spyOn(process, "exit").mockImplementation((code?: number) => {
    throw new Error(`EXIT:${code ?? 0}`);
  });
}

function makeProgram(): Command {
  const program = new Command();
  runCommands(program);
  return program;
}

describe("run command smoke", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("starts a run for a valid dag with required input", async () => {
    const dir = withTempDir();
    vi.spyOn(process, "cwd").mockReturnValue(dir);

    writeFileSync(
      join(dir, "ok.yaml"),
      `name: test\nblocks:\n  - id: b1\n    name: Block\n    inputs:\n      prompt:\n        type: string\n    outputs:\n      out:\n        type: string\n    agent:\n      role: worker\n    pre_gates: []\n    post_gates: []\n    retry:\n      max_attempts: 0\n      backoff: none\n      delay_ms: 0\nedges: []\n`
    );

    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ run_id: "run-123" }),
    }));
    vi.stubGlobal("fetch", fetchMock as unknown as typeof fetch);

    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const program = makeProgram();

    await expect(
      program.parseAsync(["node", "test", "ok.yaml", "--input", "prompt=hello", "--api", "http://localhost:4040"], { from: "node" })
    ).resolves.toBeTruthy();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(logSpy.mock.calls.join("\n")).toContain("Run started");
  });

  it("fails with clear error when required input is missing", async () => {
    const dir = withTempDir();
    vi.spyOn(process, "cwd").mockReturnValue(dir);

    writeFileSync(
      join(dir, "needs-input.yaml"),
      `name: test\nblocks:\n  - id: b1\n    name: Block\n    inputs:\n      prompt:\n        type: string\n    outputs:\n      out:\n        type: string\n    agent:\n      role: worker\n    pre_gates: []\n    post_gates: []\n    retry:\n      max_attempts: 0\n      backoff: none\n      delay_ms: 0\nedges: []\n`
    );

    installExitThrow();
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy as unknown as typeof fetch);

    const program = makeProgram();

    await expect(
      program.parseAsync(["node", "test", "needs-input.yaml", "--api", "http://localhost:4040"], { from: "node" })
    ).rejects.toThrow("EXIT:1");

    expect(errSpy.mock.calls.join("\n")).toContain("Missing required input");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("fails with clear error when dag file is invalid", async () => {
    const dir = withTempDir();
    vi.spyOn(process, "cwd").mockReturnValue(dir);

    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy as unknown as typeof fetch);

    const program = makeProgram();

    await expect(
      program.parseAsync(["node", "test", "does-not-exist.yaml", "--input", "prompt=hello", "--api", "http://localhost:4040"], { from: "node" })
    ).rejects.toThrow("DAG file not found");

    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
