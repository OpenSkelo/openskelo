import { describe, it, expect, vi, beforeEach } from "vitest";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { findConfigFile, loadConfig } from "../src/core/config.js";

function withTempDir(): string {
  return mkdtempSync(join(tmpdir(), "skelo-config-test-"));
}

describe("core/config", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("loads a valid skelo.yaml", () => {
    const dir = withTempDir();
    writeFileSync(
      join(dir, "skelo.yaml"),
      `name: sample\nagents:\n  worker1:\n    role: worker\n    provider: openai\n    model: gpt-4o-mini\npipelines:\n  default:\n    stages:\n      - name: TODO\n      - name: DONE\n`
    );

    const cfg = loadConfig(dir);
    expect(cfg.name).toBe("sample");
    expect(cfg.agents.worker1?.provider).toBe("openai");
    expect(cfg.dashboard.enabled).toBe(true);
    expect(cfg.dashboard.port).toBe(4040);
  });

  it("findConfigFile returns null when no config exists", () => {
    const dir = withTempDir();
    expect(findConfigFile(dir)).toBeNull();
  });

  it("throws clear error when config file is missing", () => {
    const dir = withTempDir();
    expect(() => loadConfig(dir)).toThrow("No skelo.yaml found");
  });

  it("throws clear error for malformed YAML", () => {
    const dir = withTempDir();
    writeFileSync(join(dir, "skelo.yaml"), "name: bad\nagents: [\n");

    expect(() => loadConfig(dir)).toThrow("skelo.yaml");
  });

  it("throws clear error when required fields are missing", () => {
    const dir = withTempDir();
    writeFileSync(join(dir, "skelo.yaml"), "name: sample\n");

    expect(() => loadConfig(dir)).toThrow("'agents' is required");
  });

  it("throws clear error when agent role is invalid", () => {
    const dir = withTempDir();
    writeFileSync(
      join(dir, "skelo.yaml"),
      `name: sample\nagents:\n  bad:\n    role: invalid\n    provider: openai\n    model: gpt-4o-mini\npipelines:\n  default:\n    stages:\n      - name: TODO\n      - name: DONE\n`
    );

    expect(() => loadConfig(dir)).toThrow("role must be one of");
  });
});
