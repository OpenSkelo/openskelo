export const VERSION = '0.0.1'

// Database
export { createDatabase } from './db.js'

// Task Store
export { TaskStore } from './task-store.js'
export type { Task, CreateTaskInput } from './task-store.js'

// State Machine
export {
  TaskStatus,
  canTransition,
  validateTransition,
  getValidTransitions,
  applyTransition,
} from './state-machine.js'
export type { TransitionContext } from './state-machine.js'

// Priority Queue
export { PriorityQueue } from './priority-queue.js'

// Audit Log
export { AuditLog } from './audit.js'
export type { AuditEntry } from './audit.js'

// Pipeline
export {
  createPipeline,
  areDependenciesMet,
  getUpstreamResults,
} from './pipeline.js'
export type { CreatePipelineTask } from './pipeline.js'

// Errors
export {
  TransitionError,
  LeaseExpiredError,
  DependencyError,
  WipLimitError,
} from './errors.js'
