import { describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { initProject } from "../src/commands/init";
const LEGACY_TEMPLATES = ["coding", "research", "content", "custom"] as const;

describe("init templates (agent-first)", () => {
  it("rejects legacy template names with a clear deprecation error", async () => {
    const base = mkdtempSync(join(tmpdir(), "openskelo-init-"));

    try {
      for (const template of LEGACY_TEMPLATES) {
        await expect(initProject(`proj-${template}`, template, { cwd: base })).rejects.toThrow(
          /Legacy init templates are deprecated/i
        );
      }
    } finally {
      rmSync(base, { recursive: true, force: true });
    }
  });

  it("agent init still emits modern skelo.yaml (no pipelines/stages)", async () => {
    const base = mkdtempSync(join(tmpdir(), "openskelo-init-"));

    try {
      await initProject("proj-agent", "agent", { cwd: base, interactive: false });

      const cfgPath = join(base, "proj-agent", "skelo.yaml");
      const cfg = readFileSync(cfgPath, "utf8");

      expect(cfg).not.toMatch(/\bpipelines\s*:/);
      expect(cfg).not.toMatch(/\bstages\s*:/);
      expect(cfg).toMatch(/\bagents\s*:/);
      expect(cfg).toMatch(/\bproviders\s*:/);
    } finally {
      rmSync(base, { recursive: true, force: true });
    }
  });
});
