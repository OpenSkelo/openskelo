import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { loadBlockContext } from "../src/core/block-context.js";

describe("loadBlockContext", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "block-ctx-"));
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("loads role.md into role field", () => {
    const blockDir = join(tempDir, "test-block");
    mkdirSync(blockDir);
    writeFileSync(join(blockDir, "role.md"), "You are a market analyst.");

    const ctx = loadBlockContext("test-block", tempDir);

    expect(ctx.role).toBe("You are a market analyst.");
    expect(ctx.rules).toBe("");
    expect(ctx.policies).toBe("");
    expect(ctx.skill_summaries).toBe("");
    expect(ctx.task).toBe("");
    expect(ctx.context).toBe("");
  });

  it("loads task.md into task field", () => {
    const blockDir = join(tempDir, "test-block");
    mkdirSync(blockDir);
    writeFileSync(join(blockDir, "task.md"), "Analyze the market data.");

    const ctx = loadBlockContext("test-block", tempDir);

    expect(ctx.task).toBe("Analyze the market data.");
  });

  it("loads rules.md into rules field", () => {
    const blockDir = join(tempDir, "test-block");
    mkdirSync(blockDir);
    writeFileSync(join(blockDir, "rules.md"), "Never leak secrets.");

    const ctx = loadBlockContext("test-block", tempDir);

    expect(ctx.rules).toBe("Never leak secrets.");
  });

  it("loads and concatenates all context/*.md files in sorted order", () => {
    const blockDir = join(tempDir, "test-block");
    mkdirSync(blockDir);
    mkdirSync(join(blockDir, "context"));
    writeFileSync(join(blockDir, "context", "b-second.md"), "Second file.");
    writeFileSync(join(blockDir, "context", "a-first.md"), "First file.");

    const ctx = loadBlockContext("test-block", tempDir);

    expect(ctx.context).toContain("First file.");
    expect(ctx.context).toContain("Second file.");
    expect(ctx.context.indexOf("First file.")).toBeLessThan(
      ctx.context.indexOf("Second file.")
    );
  });

  it("ignores non-md files in context/", () => {
    const blockDir = join(tempDir, "test-block");
    mkdirSync(blockDir);
    mkdirSync(join(blockDir, "context"));
    writeFileSync(join(blockDir, "context", "notes.md"), "Include me.");
    writeFileSync(join(blockDir, "context", "data.json"), '{"skip": true}');

    const ctx = loadBlockContext("test-block", tempDir);

    expect(ctx.context).toBe("Include me.");
    expect(ctx.context).not.toContain("skip");
  });

  it("loads only active policies from policies/", () => {
    const blockDir = join(tempDir, "test-block");
    mkdirSync(blockDir);
    mkdirSync(join(blockDir, "policies"));

    writeFileSync(
      join(blockDir, "policies", "GP-001.yaml"),
      [
        "id: GP-001",
        "status: active",
        "trigger: after outputting price",
        "action: verify via source",
        "severity: P0",
      ].join("\n")
    );

    writeFileSync(
      join(blockDir, "policies", "GP-002.yaml"),
      [
        "id: GP-002",
        "status: draft",
        "trigger: before scheduling",
        "action: check duplicates",
      ].join("\n")
    );

    const ctx = loadBlockContext("test-block", tempDir);

    expect(ctx.policies).toContain("GATING POLICIES");
    expect(ctx.policies).toContain("GP-001");
    expect(ctx.policies).not.toContain("GP-002");
  });

  it("creates skill summaries without including full skill body", () => {
    const blockDir = join(tempDir, "test-block");
    mkdirSync(blockDir);
    mkdirSync(join(blockDir, "skills"));

    writeFileSync(
      join(blockDir, "skills", "analysis.md"),
      [
        "---",
        "name: technical-analysis",
        "description: Analyze price action with RSI and levels",
        "---",
        "",
        "# Technical Analysis",
        "Long skill body that should not be injected in full.",
      ].join("\n")
    );

    const ctx = loadBlockContext("test-block", tempDir);

    expect(ctx.skill_summaries).toContain("<available_skills>");
    expect(ctx.skill_summaries).toContain("technical-analysis");
    expect(ctx.skill_summaries).toContain("Analyze price action with RSI and levels");
    expect(ctx.skill_summaries).not.toContain("Long skill body that should not be injected in full");
  });

  it("returns empty strings when block_dir has no files", () => {
    const blockDir = join(tempDir, "empty-block");
    mkdirSync(blockDir);

    const ctx = loadBlockContext("empty-block", tempDir);

    expect(ctx.role).toBe("");
    expect(ctx.rules).toBe("");
    expect(ctx.policies).toBe("");
    expect(ctx.skill_summaries).toBe("");
    expect(ctx.task).toBe("");
    expect(ctx.context).toBe("");
  });

  it("returns empty strings when block_dir does not exist", () => {
    const ctx = loadBlockContext("nonexistent", tempDir);

    expect(ctx.role).toBe("");
    expect(ctx.rules).toBe("");
    expect(ctx.policies).toBe("");
    expect(ctx.skill_summaries).toBe("");
    expect(ctx.task).toBe("");
    expect(ctx.context).toBe("");
  });

  it("loads all context components together", () => {
    const blockDir = join(tempDir, "full-block");
    mkdirSync(blockDir);
    mkdirSync(join(blockDir, "context"));
    mkdirSync(join(blockDir, "policies"));
    mkdirSync(join(blockDir, "skills"));

    writeFileSync(join(blockDir, "role.md"), "You are an expert.");
    writeFileSync(join(blockDir, "rules.md"), "Never fabricate.");
    writeFileSync(join(blockDir, "task.md"), "Do the analysis.");
    writeFileSync(join(blockDir, "context", "ref.md"), "Reference data.");
    writeFileSync(
      join(blockDir, "policies", "GP-100.yaml"),
      [
        "id: GP-100",
        "status: active",
        "trigger: after output",
        "action: verify facts",
      ].join("\n")
    );
    writeFileSync(
      join(blockDir, "skills", "writer.md"),
      [
        "---",
        "name: report-writer",
        "description: Write concise reports",
        "---",
        "Use this for writing.",
      ].join("\n")
    );

    const ctx = loadBlockContext("full-block", tempDir);

    expect(ctx.role).toBe("You are an expert.");
    expect(ctx.rules).toBe("Never fabricate.");
    expect(ctx.task).toBe("Do the analysis.");
    expect(ctx.context).toBe("Reference data.");
    expect(ctx.policies).toContain("GP-100");
    expect(ctx.skill_summaries).toContain("report-writer");
  });

  it("throws when block_dir resolves outside project root", () => {
    expect(() => loadBlockContext("../escape", tempDir)).toThrow(
      /resolves outside project root/
    );
  });
});
