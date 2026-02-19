import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createDB, closeDB } from "../src/core/db.js";
import { CostTracker } from "../src/persistence/cost-tracker.js";

describe("CostTracker", () => {
  let dir: string;

  afterEach(() => {
    closeDB();
    if (dir) rmSync(dir, { recursive: true, force: true });
  });

  it("records and aggregates costs", async () => {
    dir = mkdtempSync(join(tmpdir(), "cost-tracker-"));
    const db = createDB(dir);
    const tracker = new CostTracker(db);

    await tracker.record({
      agentId: "nora",
      runId: "r1",
      model: "gpt-4o-mini",
      inputTokens: 100,
      outputTokens: 20,
      costUsd: 0.001,
      durationMs: 120,
    });

    await tracker.record({
      agentId: "nora",
      runId: "r2",
      model: "gpt-4o-mini",
      inputTokens: 120,
      outputTokens: 30,
      costUsd: 0.002,
      durationMs: 150,
    });

    await tracker.record({
      agentId: "scout",
      runId: "r3",
      model: "claude-haiku-4-5",
      inputTokens: 50,
      outputTokens: 10,
      costUsd: 0.0005,
      durationMs: 90,
    });

    const noraTotal = await tracker.agentTotal("nora");
    const noraDaily = await tracker.dailyTotal("nora");
    const monthly = await tracker.monthlyTotal();

    expect(noraTotal).toBeCloseTo(0.003, 6);
    expect(noraDaily).toBeCloseTo(0.003, 6);
    expect(monthly).toBeCloseTo(0.0035, 6);
  });
});
