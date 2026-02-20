export const VERSION = '0.0.1'

// Base class
export { BaseCliAdapter } from './base-cli-adapter.js'

// Adapters
export { ClaudeCodeAdapter } from './adapters/claude-code.js'
export { RawApiAdapter } from './adapters/raw-api.js'
export { ShellAdapter } from './adapters/shell.js'
export { CodexAdapter } from './adapters/codex.js'
export { AiderAdapter } from './adapters/aider.js'

// Utilities
export { buildTaskPrompt } from './utils/prompt-builder.js'

// Types
export type {
  ExecutionAdapter,
  AdapterResult,
  AdapterConfig,
  TaskInput,
  CostInfo,
  BounceContext,
  TaskRetryContext,
} from './types.js'

export type { RetryContext } from './types.js'
