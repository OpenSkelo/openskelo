import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { loadAgent, loadAllAgents } from "../../src/agents/loader.js";

describe("loadAgent", () => {
  let root: string;
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "agent-loader-"));
  });
  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it("loads a full agent directory", async () => {
    const dir = join(root, "scout");
    mkdirSync(join(dir, "skills"), { recursive: true });
    mkdirSync(join(dir, "context"), { recursive: true });
    mkdirSync(join(dir, "policies"), { recursive: true });
    mkdirSync(join(dir, "procedural"), { recursive: true });

    writeFileSync(join(dir, "agent.yaml"), "id: scout\nname: Scout\nmodel:\n  primary: claude-haiku-4-5\n");
    writeFileSync(join(dir, "role.md"), "role");
    writeFileSync(join(dir, "task.md"), "task");
    writeFileSync(join(dir, "rules.md"), "rules");
    writeFileSync(join(dir, "skills", "x.md"), "x");
    writeFileSync(join(dir, "context", "x.md"), "x");
    writeFileSync(join(dir, "policies", "x.yaml"), "id: GP-1");
    writeFileSync(join(dir, "procedural", "x.md"), "x");
    writeFileSync(join(dir, "mcp.json"), "{}");
    writeFileSync(join(dir, "memory.json"), "{}");

    const agent = await loadAgent(dir);
    expect(agent.id).toBe("scout");
    expect(agent.hasRole).toBe(true);
    expect(agent.hasSkills).toBe(true);
    expect(agent.hasPolicies).toBe(true);
    expect(agent.hasProcedural).toBe(true);
    expect(agent.hasMcp).toBe(true);
    expect(agent.hasMemory).toBe(true);
  });

  it("throws when agent.yaml missing", async () => {
    const dir = join(root, "bad");
    mkdirSync(dir);
    await expect(loadAgent(dir)).rejects.toThrow(/No agent\.yaml/);
  });

  it("throws on invalid YAML shape", async () => {
    const dir = join(root, "bad");
    mkdirSync(dir);
    writeFileSync(join(dir, "agent.yaml"), "name: MissingId\nmodel:\n  primary: claude-haiku-4-5\n");
    await expect(loadAgent(dir)).rejects.toThrow();
  });
});

describe("loadAllAgents", () => {
  let root: string;
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "agent-loader-all-"));
  });
  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it("loads valid agents and skips invalid dirs", async () => {
    const good = join(root, "good");
    mkdirSync(good);
    writeFileSync(join(good, "agent.yaml"), "id: good\nname: Good\nmodel:\n  primary: claude-haiku-4-5\n");

    const bad = join(root, "bad");
    mkdirSync(bad);
    writeFileSync(join(bad, "agent.yaml"), "name: bad\n");

    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const loaded = await loadAllAgents(root);

    expect(loaded.size).toBe(1);
    expect(loaded.has("good")).toBe(true);
    expect(warn).toHaveBeenCalled();

    warn.mockRestore();
  });
});
