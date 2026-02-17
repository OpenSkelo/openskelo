import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createAPI } from "../../src/server/api";
import { createDB, closeDB } from "../../src/core/db";
import { createTaskEngine } from "../../src/core/task-engine";
import { createGateEngine } from "../../src/core/gate-engine";
import { createRouter } from "../../src/core/router";
import { createRunEngine } from "../../src/core/run-engine";
import type { SkeloConfig } from "../../src/types";

export function createTestConfig(): SkeloConfig {
  return {
    name: "OpenSkelo Test",
    storage: "sqlite",
    providers: [],
    dashboard: { enabled: false, port: 4040 },
    agents: {
      manager: {
        role: "manager",
        capabilities: ["planning"],
        provider: "local",
        model: "test",
        max_concurrent: 2,
      },
      worker: {
        role: "worker",
        capabilities: ["build"],
        provider: "local",
        model: "test",
        max_concurrent: 2,
      },
      reviewer: {
        role: "reviewer",
        capabilities: ["review"],
        provider: "local",
        model: "test",
        max_concurrent: 2,
      },
    },
    pipelines: {
      core: {
        stages: [
          { name: "PENDING", transitions: ["IN_PROGRESS"] },
          { name: "IN_PROGRESS", transitions: ["REVIEW"] },
          { name: "REVIEW", transitions: ["DONE", "IN_PROGRESS"] },
          { name: "DONE", transitions: [] },
        ],
      },
    },
    gates: [],
  };
}

export function setupTestApp() {
  const workdir = mkdtempSync(join(tmpdir(), "openskelo-test-"));

  const config = createTestConfig();
  createDB(workdir);

  const taskEngine = createTaskEngine(config.pipelines);
  const gateEngine = createGateEngine(config.gates);
  const router = createRouter(config.agents, config.pipelines);
  const runEngine = createRunEngine({ baseDir: workdir });
  const app = createAPI({ config, taskEngine, gateEngine, router, runEngine });

  return {
    app,
    workdir,
    runEngine,
    cleanup: () => {
      closeDB();
    },
  };
}
