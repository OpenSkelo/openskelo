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
  createDagPipeline,
  areDependenciesMet,
  getUpstreamResults,
} from './pipeline.js'
export type { CreatePipelineTask, DagNode, CreateDagPipelineInput } from './pipeline.js'

// Dispatcher
export { Dispatcher } from './dispatcher.js'
export type { DispatcherConfig, DispatchResult } from './dispatcher.js'

// Watchdog
export { Watchdog } from './watchdog.js'
export type { WatchdogConfig, WatchdogResult } from './watchdog.js'

// REST API
export { createApiRouter } from './api.js'
export type { ApiConfig, ApiDependencies } from './api.js'

// Dashboard
export { createDashboardRouter } from './dashboard.js'

// Factory
export { createQueue } from './factory.js'
export type { QueueConfig, Queue } from './factory.js'

// Config
export { loadConfig, resolveAdapters } from './config.js'
export type { AdapterYamlConfig } from './config.js'

// Errors
export {
  TransitionError,
  LeaseExpiredError,
  DependencyError,
  WipLimitError,
} from './errors.js'
