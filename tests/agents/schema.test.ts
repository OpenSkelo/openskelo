import { describe, expect, it } from "vitest";
import { AgentYamlSchema } from "../../src/agents/schema.js";

describe("AgentYamlSchema", () => {
  it("validates full config", () => {
    const parsed = AgentYamlSchema.parse({
      id: "scout",
      name: "Scout",
      runtime: "direct",
      model: { primary: "claude-haiku-4-5" },
      autonomy: "read_only",
      inputs: [{ name: "tickers", type: "json", required: true }],
      outputs: [{ name: "report", type: "json" }],
    });

    expect(parsed.id).toBe("scout");
    expect(parsed.model.primary).toBe("claude-haiku-4-5");
  });

  it("applies defaults for minimal config", () => {
    const parsed = AgentYamlSchema.parse({
      id: "test",
      name: "Test",
      model: { primary: "claude-haiku-4-5" },
    });

    expect(parsed.runtime).toBe("direct");
    expect(parsed.autonomy).toBe("read_only");
    expect(parsed.model.routing.strategy).toBe("adaptive");
    expect(parsed.permissions.can_spend_per_run).toBe(0.5);
  });

  it("rejects invalid autonomy", () => {
    expect(() =>
      AgentYamlSchema.parse({
        id: "x",
        name: "X",
        model: { primary: "claude-haiku-4-5" },
        autonomy: "superuser",
      })
    ).toThrow();
  });

  it("rejects negative budget", () => {
    expect(() =>
      AgentYamlSchema.parse({
        id: "x",
        name: "X",
        model: { primary: "claude-haiku-4-5" },
        permissions: { can_spend_per_run: -1 },
      })
    ).toThrow();
  });

  it("rejects unknown runtime", () => {
    expect(() =>
      AgentYamlSchema.parse({
        id: "x",
        name: "X",
        model: { primary: "claude-haiku-4-5" },
        runtime: "openclaw",
      })
    ).toThrow();
  });
});
