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

  it("returns empty strings when block_dir has no files", () => {
    const blockDir = join(tempDir, "empty-block");
    mkdirSync(blockDir);

    const ctx = loadBlockContext("empty-block", tempDir);

    expect(ctx.role).toBe("");
    expect(ctx.task).toBe("");
    expect(ctx.context).toBe("");
  });

  it("returns empty strings when block_dir does not exist", () => {
    const ctx = loadBlockContext("nonexistent", tempDir);

    expect(ctx.role).toBe("");
    expect(ctx.task).toBe("");
    expect(ctx.context).toBe("");
  });

  it("loads all three: role + task + context together", () => {
    const blockDir = join(tempDir, "full-block");
    mkdirSync(blockDir);
    mkdirSync(join(blockDir, "context"));
    writeFileSync(join(blockDir, "role.md"), "You are an expert.");
    writeFileSync(join(blockDir, "task.md"), "Do the analysis.");
    writeFileSync(join(blockDir, "context", "ref.md"), "Reference data.");

    const ctx = loadBlockContext("full-block", tempDir);

    expect(ctx.role).toBe("You are an expert.");
    expect(ctx.task).toBe("Do the analysis.");
    expect(ctx.context).toBe("Reference data.");
  });

  it("throws when block_dir resolves outside project root", () => {
    expect(() => loadBlockContext("../escape", tempDir)).toThrow(
      /resolves outside project root/
    );
  });
});
