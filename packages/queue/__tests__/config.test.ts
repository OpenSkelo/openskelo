import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import * as fs from 'node:fs'
import * as path from 'node:path'
import * as os from 'node:os'
import { loadConfig, resolveAdapters } from '../src/config.js'
import type { AdapterYamlConfig } from '../src/config.js'

describe('loadConfig', () => {
  let tmpDir: string

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'openskelo-config-'))
  })

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true })
    vi.restoreAllMocks()
  })

  function writeYaml(filename: string, content: string): string {
    const filePath = path.join(tmpDir, filename)
    fs.writeFileSync(filePath, content)
    return filePath
  }

  it('loads valid YAML config', () => {
    const configPath = writeYaml('openskelo.yaml', `
db_path: ./test.db

adapters:
  - name: shell
    type: cli
    task_types: [script]
`)

    const config = loadConfig(configPath)
    expect(config.db_path).toBe('./test.db')
  })

  it('substitutes environment variables', () => {
    vi.stubEnv('TEST_DB_PATH', '/tmp/env-test.db')

    const configPath = writeYaml('openskelo.yaml', `
db_path: \${TEST_DB_PATH}

adapters:
  - name: shell
    type: cli
    task_types: [script]
`)

    const config = loadConfig(configPath)
    expect(config.db_path).toBe('/tmp/env-test.db')
  })

  it('substitutes env vars with defaults (${VAR:-default})', () => {
    const configPath = writeYaml('openskelo.yaml', `
db_path: ./test.db

server:
  port: \${MISSING_PORT:-4820}
  host: \${MISSING_HOST:-127.0.0.1}

adapters:
  - name: shell
    type: cli
    task_types: [script]
`)

    const config = loadConfig(configPath)
    expect(config.server?.port).toBe(4820)
    expect(config.server?.host).toBe('127.0.0.1')
  })

  it('throws on missing required env var', () => {
    delete process.env.TOTALLY_MISSING_VAR

    const configPath = writeYaml('openskelo.yaml', `
db_path: \${TOTALLY_MISSING_VAR}

adapters:
  - name: shell
    type: cli
    task_types: [script]
`)

    expect(() => loadConfig(configPath)).toThrow('TOTALLY_MISSING_VAR')
  })

  it('validates db_path is required', () => {
    const configPath = writeYaml('openskelo.yaml', `
adapters:
  - name: shell
    type: cli
    task_types: [script]
`)

    expect(() => loadConfig(configPath)).toThrow('db_path')
  })

  it('returns valid QueueConfig with all sections', () => {
    const configPath = writeYaml('openskelo.yaml', `
db_path: ./test.db

wip_limits:
  code: 2
  default: 1

leases:
  ttl_seconds: 600
  heartbeat_interval_seconds: 30
  grace_period_seconds: 15

dispatcher:
  poll_interval_seconds: 10

watchdog:
  interval_seconds: 60
  on_lease_expire: block

server:
  port: 5000
  host: 0.0.0.0

adapters:
  - name: shell
    type: cli
    task_types: [script]
`)

    const config = loadConfig(configPath)
    expect(config.wip_limits).toEqual({ code: 2, default: 1 })
    expect(config.leases?.ttl_seconds).toBe(600)
    expect(config.leases?.heartbeat_interval_seconds).toBe(30)
    expect(config.leases?.grace_period_seconds).toBe(15)
    expect(config.dispatcher?.poll_interval_seconds).toBe(10)
    expect(config.watchdog?.interval_seconds).toBe(60)
    expect(config.watchdog?.on_lease_expire).toBe('block')
    expect(config.server?.port).toBe(5000)
    expect(config.server?.host).toBe('0.0.0.0')
  })

  it('gates config parsed correctly', () => {
    const configPath = writeYaml('openskelo.yaml', `
db_path: ./test.db

gates:
  code:
    - type: word_count
      min: 10
    - type: regex
      pattern: "function"

adapters:
  - name: shell
    type: cli
    task_types: [script]
`)

    const config = loadConfig(configPath)
    expect(config.gates).toEqual({
      code: [
        { type: 'word_count', min: 10 },
        { type: 'regex', pattern: 'function' },
      ],
    })
  })

  it('WIP limits parsed correctly', () => {
    const configPath = writeYaml('openskelo.yaml', `
db_path: ./test.db

wip_limits:
  code: 3
  script: 1
  default: 2

adapters:
  - name: shell
    type: cli
    task_types: [script]
`)

    const config = loadConfig(configPath)
    expect(config.wip_limits).toEqual({ code: 3, script: 1, default: 2 })
  })

  it('config with webhooks section parses correctly', () => {
    const configPath = writeYaml('openskelo.yaml', `
db_path: ./test.db

webhooks:
  - url: https://example.com/hook
    events: [review, blocked]
  - url: https://hooks.slack.com/services/xxx
    events: [review, done]
    body_template: slack

adapters:
  - name: shell
    type: cli
    task_types: [script]
`)

    const config = loadConfig(configPath)
    expect(config.webhooks).toHaveLength(2)
    expect(config.webhooks![0].url).toBe('https://example.com/hook')
    expect(config.webhooks![0].events).toEqual(['review', 'blocked'])
    expect(config.webhooks![1].body_template).toBe('slack')
  })

  it('webhook URLs get env var substitution', () => {
    vi.stubEnv('TEST_BOT_TOKEN', 'my-bot-token')

    const configPath = writeYaml('openskelo.yaml', `
db_path: ./test.db

webhooks:
  - url: https://api.telegram.org/bot\${TEST_BOT_TOKEN}/sendMessage
    events: [review]
    body_template: telegram

adapters:
  - name: shell
    type: cli
    task_types: [script]
`)

    const config = loadConfig(configPath)
    expect(config.webhooks![0].url).toBe('https://api.telegram.org/botmy-bot-token/sendMessage')
  })

  it('webhook config includes chat_id', () => {
    const configPath = writeYaml('openskelo.yaml', `
db_path: ./test.db

webhooks:
  - url: https://api.telegram.org/bot123/sendMessage
    events: [review]
    body_template: telegram
    chat_id: "987654"

adapters:
  - name: shell
    type: cli
    task_types: [script]
`)

    const config = loadConfig(configPath)
    expect(config.webhooks![0].chat_id).toBe('987654')
  })

  it('schedules config parsed correctly', () => {
    const configPath = writeYaml('openskelo.yaml', `
db_path: ./test.db

schedules:
  - template: nightly-tests
    every: 24h
  - template: weekly-audit
    every: 7d
    enabled: false

adapters:
  - name: shell
    type: cli
    task_types: [script]
`)

    const config = loadConfig(configPath)
    expect(config.schedules).toHaveLength(2)
    expect(config.schedules![0].template).toBe('nightly-tests')
    expect(config.schedules![0].every).toBe('24h')
    expect(config.schedules![1].enabled).toBe(false)
  })

  it('handles minimal config (just db_path and one adapter)', () => {
    const configPath = writeYaml('openskelo.yaml', `
db_path: ./minimal.db

adapters:
  - name: shell
    type: cli
    task_types: [script]
`)

    const config = loadConfig(configPath)
    expect(config.db_path).toBe('./minimal.db')
    expect(config.wip_limits).toBeUndefined()
    expect(config.leases).toBeUndefined()
    expect(config.server).toBeUndefined()
  })
})

describe('resolveAdapters', () => {
  it('creates ClaudeCodeAdapter for name "claude-code"', () => {
    const configs: AdapterYamlConfig[] = [
      { name: 'claude-code', type: 'cli', task_types: ['code'] },
    ]
    const adapters = resolveAdapters(configs)
    expect(adapters).toHaveLength(1)
    expect(adapters[0].name).toBe('claude-code')
  })

  it('creates ShellAdapter for name "shell"', () => {
    const configs: AdapterYamlConfig[] = [
      { name: 'shell', type: 'cli', task_types: ['script'] },
    ]
    const adapters = resolveAdapters(configs)
    expect(adapters).toHaveLength(1)
    expect(adapters[0].name).toBe('shell')
  })

  it('creates RawApiAdapter for type "api"', () => {
    const configs: AdapterYamlConfig[] = [
      { name: 'raw-api', type: 'api', task_types: ['chat'], provider: 'anthropic', model: 'claude-sonnet-4-5-20250929' },
    ]
    const adapters = resolveAdapters(configs)
    expect(adapters).toHaveLength(1)
    expect(adapters[0].name).toBe('raw-api')
  })

  it('creates CodexAdapter for name "codex"', () => {
    const configs: AdapterYamlConfig[] = [
      { name: 'codex', type: 'cli', task_types: ['code'] },
    ]
    const adapters = resolveAdapters(configs)
    expect(adapters).toHaveLength(1)
    expect(adapters[0].name).toBe('codex')
  })
})
