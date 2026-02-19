import { describe, expect, it } from "vitest";
import { mkdtempSync, existsSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parse as parseYaml } from "yaml";
import { initProject } from "../src/commands/init";
import { AgentYamlSchema } from "../src/agents/schema";

describe("init agent scaffold", () => {
  it("creates agent-first project structure", async () => {
    const base = mkdtempSync(join(tmpdir(), "openskelo-init-agent-"));

    try {
      await initProject("agent-proj", "agent", { cwd: base, interactive: false });
      const root = join(base, "agent-proj");

      expect(existsSync(join(root, "skelo.yaml"))).toBe(true);
      expect(existsSync(join(root, ".skelo", "secrets.yaml"))).toBe(true);
      expect(existsSync(join(root, "agents", "nora", "agent.yaml"))).toBe(true);
      expect(existsSync(join(root, "agents", "nora", "role.md"))).toBe(true);
      expect(existsSync(join(root, "agents", "nora", "task.md"))).toBe(true);
      expect(existsSync(join(root, "agents", "nora", "rules.md"))).toBe(true);

      const parsed = parseYaml(readFileSync(join(root, "agents", "nora", "agent.yaml"), "utf8"));
      const valid = AgentYamlSchema.parse(parsed);
      expect(valid.id).toBe("nora");
      expect(valid.runtime).toBe("direct");
    } finally {
      rmSync(base, { recursive: true, force: true });
    }
  });
});
