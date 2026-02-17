// OpenSkelo — Give your AI agents a backbone.
// Public API for programmatic usage

export { loadConfig } from "./core/config.js";
export { createTaskEngine } from "./core/task-engine.js";
export { createGateEngine } from "./core/gate-engine.js";
export { createRouter } from "./core/router.js";
export { createDB } from "./core/db.js";
export { createRunEngine } from "./core/run-engine.js";

export type { SkeloConfig, Agent, Pipeline, Gate, Task, RunModel, BlockStep, BlockOutput, RunEvent } from "./types.js";
