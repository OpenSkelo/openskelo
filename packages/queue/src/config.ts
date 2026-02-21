import * as fs from 'node:fs'
import * as path from 'node:path'
import { parse as parseYaml } from 'yaml'
import type { ExecutionAdapter } from '@openskelo/adapters'
import {
  ClaudeCodeAdapter,
  CodexAdapter,
  AiderAdapter,
  ShellAdapter,
  RawApiAdapter,
  OpenRouterAdapter,
  BaseCliAdapter,
} from '@openskelo/adapters'
import type { TaskInput, AdapterResult } from '@openskelo/adapters'
import type { QueueConfig } from './factory.js'
import type { WebhookConfig } from './webhooks.js'
import type { ScheduleConfig } from './scheduler.js'

export interface AdapterYamlConfig {
  name: string
  type: 'cli' | 'api'
  task_types: string[]
  command?: string
  args?: string[]
  cwd?: string
  env?: Record<string, string>
  model?: string
  provider?: string
  timeout_ms?: number
  api_key?: string
}

interface RawConfig {
  db_path?: string
  adapters?: AdapterYamlConfig[]
  wip_limits?: Record<string, number>
  leases?: {
    ttl_seconds?: number
    heartbeat_interval_seconds?: number
    grace_period_seconds?: number
  }
  dispatcher?: {
    poll_interval_seconds?: number
  }
  watchdog?: {
    interval_seconds?: number
    on_lease_expire?: 'requeue' | 'block'
  }
  server?: {
    port?: number | string
    host?: string
    api_key?: string
  }
  gates?: Record<string, unknown[]>
  webhooks?: Array<{
    url: string
    events: string[]
    headers?: Record<string, string>
    method?: string
    body_template?: string
    timeout_ms?: number
    chat_id?: string
  }>
  schedules?: Array<{
    template: string
    every: string
    enabled?: boolean
  }>
}

function substituteEnvVars(text: string): string {
  // Match ${VAR_NAME} and ${VAR_NAME:-default}
  return text.replace(/\$\{([^}]+)\}/g, (_match, expr: string) => {
    const defaultSep = expr.indexOf(':-')
    if (defaultSep !== -1) {
      const varName = expr.slice(0, defaultSep)
      const defaultValue = expr.slice(defaultSep + 2)
      return process.env[varName] ?? defaultValue
    }

    const varName = expr.trim()
    const value = process.env[varName]
    if (value === undefined) {
      throw new Error(`Environment variable ${varName} is not set (referenced in config)`)
    }
    return value
  })
}

export function loadConfig(configPath?: string): QueueConfig & { gates?: Record<string, unknown[]>; webhooks?: WebhookConfig[]; schedules?: ScheduleConfig[] } {
  const resolvedPath = configPath ?? path.join(process.cwd(), 'openskelo.yaml')

  if (!fs.existsSync(resolvedPath)) {
    throw new Error(`Config file not found: ${resolvedPath}`)
  }

  const rawText = fs.readFileSync(resolvedPath, 'utf-8')
  const substituted = substituteEnvVars(rawText)
  const raw = parseYaml(substituted) as RawConfig

  if (!raw.db_path) {
    throw new Error('Config validation failed: db_path is required')
  }

  const config: QueueConfig & { gates?: Record<string, unknown[]>; webhooks?: WebhookConfig[]; schedules?: ScheduleConfig[] } = {
    db_path: raw.db_path,
  }

  if (raw.adapters) {
    config.adapters = resolveAdapters(raw.adapters)
  }

  if (raw.wip_limits) {
    config.wip_limits = raw.wip_limits
  }

  if (raw.leases) {
    config.leases = raw.leases
  }

  if (raw.dispatcher) {
    config.dispatcher = raw.dispatcher
  }

  if (raw.watchdog) {
    config.watchdog = raw.watchdog
  }

  if (raw.server) {
    config.server = {
      port: typeof raw.server.port === 'string'
        ? parseInt(raw.server.port, 10)
        : raw.server.port,
      host: raw.server.host,
      api_key: raw.server.api_key,
    }
  }

  if (raw.gates) {
    config.gates = raw.gates
  }

  if (raw.webhooks) {
    config.webhooks = raw.webhooks.map((w): WebhookConfig => ({
      url: w.url,
      events: w.events,
      headers: w.headers,
      method: (w.method as 'POST' | 'GET') ?? 'POST',
      body_template: (w.body_template as 'default' | 'telegram' | 'slack') ?? 'default',
      timeout_ms: w.timeout_ms ?? 5000,
      chat_id: w.chat_id,
    }))
  }

  if (raw.schedules) {
    config.schedules = raw.schedules.map((s): ScheduleConfig => ({
      template: s.template,
      every: s.every,
      enabled: s.enabled,
    }))
  }

  return config
}

class GenericCliAdapter extends BaseCliAdapter {
  buildPrompt(task: TaskInput): string {
    return task.prompt
  }

  parseOutput(
    stdout: string,
    _stderr: string,
    exitCode: number,
    _task: TaskInput,
  ): AdapterResult {
    return {
      output: stdout,
      exit_code: exitCode,
      duration_ms: 0,
    }
  }
}

const KNOWN_CLI_ADAPTERS: Record<string, () => ExecutionAdapter> = {
  'claude-code': () => new ClaudeCodeAdapter(),
  'codex': () => new CodexAdapter(),
  'aider': () => new AiderAdapter(),
  'shell': () => new ShellAdapter(),
}

export function resolveAdapters(configs: AdapterYamlConfig[]): ExecutionAdapter[] {
  return configs.map((cfg) => {
    if (cfg.type === 'api') {
      if (cfg.provider === 'openrouter') {
        const env: Record<string, string> = { ...cfg.env }
        if (cfg.api_key) env.OPENROUTER_API_KEY = cfg.api_key
        return new OpenRouterAdapter(cfg.task_types, {
          model: cfg.model,
          timeout_ms: cfg.timeout_ms,
          env,
        })
      }
      return new RawApiAdapter()
    }

    const factory = KNOWN_CLI_ADAPTERS[cfg.name]
    if (factory) {
      return factory()
    }

    // Generic CLI adapter for unknown names
    return new GenericCliAdapter(cfg.name, cfg.task_types, {
      command: cfg.command,
      args: cfg.args,
      cwd: cfg.cwd,
      env: cfg.env,
      timeout_ms: cfg.timeout_ms,
    })
  })
}
