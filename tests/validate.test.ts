import { describe, it, expect, vi, beforeEach } from "vitest";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { validateCommand } from "../src/commands/validate.js";

function withTempDir(): string {
  return mkdtempSync(join(tmpdir(), "skelo-validate-test-"));
}

describe("validate command smoke", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("passes on a valid DAG yaml", async () => {
    const dir = withTempDir();
    vi.spyOn(process, "cwd").mockReturnValue(dir);

    writeFileSync(
      join(dir, "valid.yaml"),
      `name: test\nblocks:\n  - id: b1\n    name: Block\n    inputs:\n      prompt:\n        type: string\n    outputs:\n      out:\n        type: string\n    agent:\n      role: worker\n    pre_gates: []\n    post_gates: []\n    retry:\n      max_attempts: 0\n      backoff: none\n      delay_ms: 0\nedges: []\n`
    );

    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    await expect(validateCommand("valid.yaml")).resolves.toBeUndefined();
    expect(logSpy).toHaveBeenCalled();
  });

  it("fails with clear error on missing file", async () => {
    const dir = withTempDir();
    vi.spyOn(process, "cwd").mockReturnValue(dir);

    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(process, "exit").mockImplementation((code?: number) => {
      throw new Error(`EXIT:${code ?? 0}`);
    });

    await expect(validateCommand("missing.yaml")).rejects.toThrow("EXIT:1");
    expect(errSpy.mock.calls.join("\n")).toContain("DAG file not found");
  });

  it("fails with clear error on invalid yaml", async () => {
    const dir = withTempDir();
    vi.spyOn(process, "cwd").mockReturnValue(dir);

    writeFileSync(join(dir, "invalid.yaml"), "name: bad\nblocks: [\n");

    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(process, "exit").mockImplementation((code?: number) => {
      throw new Error(`EXIT:${code ?? 0}`);
    });

    await expect(validateCommand("invalid.yaml")).rejects.toThrow("EXIT:1");
    const out = errSpy.mock.calls.join("\n");
    expect(out).toContain("invalid.yaml");
  });
});
