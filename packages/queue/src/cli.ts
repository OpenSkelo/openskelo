#!/usr/bin/env node

import * as fs from 'node:fs'
import * as path from 'node:path'
import { loadConfig } from './config.js'
import { createQueue } from './factory.js'

export interface ParsedArgs {
  command: string
  flags: Record<string, string>
}

export function parseArgs(argv: string[]): ParsedArgs {
  const args = argv.slice(2)
  const command = args[0] ?? 'help'
  const flags: Record<string, string> = {}

  for (let i = 1; i < args.length; i++) {
    if (args[i].startsWith('--') && i + 1 < args.length) {
      const key = args[i].slice(2)
      flags[key] = args[i + 1]
      i++
    }
  }

  const validCommands = ['init', 'start', 'status', 'add', 'list', 'help']
  return {
    command: validCommands.includes(command) ? command : 'help',
    flags,
  }
}

export function generateTemplate(): string {
  return `# OpenSkelo Configuration
# See docs/SPEC.md for full reference

# Database path (required)
db_path: ./openskelo.db

# Adapters — execution backends
adapters:
  - name: claude-code
    type: cli
    task_types: [code, refactor, test, review]
    # command: claude
    # args: ["--print", "--model", "sonnet"]
    # cwd: ~/projects/myapp
    # timeout_ms: 600000

  - name: shell
    type: cli
    task_types: [script, build, deploy]
    # command: sh

  # - name: codex
  #   type: cli
  #   task_types: [code, refactor]

  # - name: aider
  #   type: cli
  #   task_types: [code, refactor]

  # - name: raw-api
  #   type: api
  #   task_types: [chat, completion]
  #   provider: anthropic
  #   model: claude-sonnet-4-5-20250929

# WIP limits per task type
wip_limits:
  code: 1
  script: 1
  default: 1

# Lease configuration
leases:
  ttl_seconds: 1200           # 20 minutes
  heartbeat_interval_seconds: 60
  grace_period_seconds: 30

# Dispatcher settings
dispatcher:
  poll_interval_seconds: 5

# Watchdog settings
watchdog:
  interval_seconds: 30
  on_lease_expire: requeue    # 'requeue' or 'block'

# REST API server
server:
  port: \${PORT:-4820}
  host: \${HOST:-127.0.0.1}
  # api_key: \${OPENSKELO_API_KEY}

# Gates per task type
gates:
  code:
    - type: word_count
      min: 10
    - type: regex
      pattern: "(?:function|class|const|let|import)"
  # review:
  #   - type: json_schema
  #     schema:
  #       type: object
  #       properties:
  #         approved:
  #           type: boolean
  #       required: [approved]
`
}

export function buildRequestHeaders(apiKey?: string, includeJson = false): Record<string, string> {
  const headers: Record<string, string> = {}
  if (includeJson) {
    headers['Content-Type'] = 'application/json'
  }
  if (apiKey) {
    headers['x-api-key'] = apiKey
  }
  return headers
}

function printHelp(): void {
  console.log(`
OpenSkelo — AI Task Orchestrator

Usage:
  openskelo init                  Create openskelo.yaml template
  openskelo start [--config path] Start queue, dispatcher, and API server
  openskelo status [--config path] Show queue health status
  openskelo add [--config path]   Add task (reads JSON from stdin)
  openskelo list [--config path] [--status STATUS] List tasks
  openskelo help                  Show this help

Options:
  --config path   Path to config file (default: ./openskelo.yaml)
  --status STATUS Filter tasks by status (PENDING, IN_PROGRESS, REVIEW, DONE, BLOCKED)
`)
}

async function cmdInit(): Promise<void> {
  const filePath = path.join(process.cwd(), 'openskelo.yaml')
  if (fs.existsSync(filePath)) {
    console.error('openskelo.yaml already exists. Aborting.')
    process.exitCode = 1
    return
  }

  fs.writeFileSync(filePath, generateTemplate())
  console.log('Created openskelo.yaml')
  console.log('Edit the config, then run: openskelo start')
}

async function cmdStart(flags: Record<string, string>): Promise<void> {
  const config = loadConfig(flags.config)
  const queue = createQueue(config)

  queue.start()
  const { port, close } = await queue.listen()
  const host = config.server?.host ?? '127.0.0.1'

  console.log(`OpenSkelo running on http://${host}:${port}`)
  console.log(`Dashboard: http://${host}:${port}/dashboard`)
  console.log('Press Ctrl+C to stop')

  const shutdown = () => {
    console.log('\nShutting down...')
    queue.stop()
    close()
    queue.db.close()
    process.exit(0)
  }

  process.on('SIGINT', shutdown)
  process.on('SIGTERM', shutdown)
}

async function cmdStatus(flags: Record<string, string>): Promise<void> {
  const config = loadConfig(flags.config)
  const port = config.server?.port ?? 4820
  const host = config.server?.host ?? '127.0.0.1'

  try {
    const res = await fetch(`http://${host}:${port}/health`, {
      headers: buildRequestHeaders(config.server?.api_key),
    })
    const data = await res.json() as { status: string; counts: Record<string, number> }

    console.log(`Status: ${data.status}`)
    console.log('Task counts:')
    for (const [status, count] of Object.entries(data.counts)) {
      console.log(`  ${status}: ${count}`)
    }
  } catch {
    console.error(`Could not connect to OpenSkelo at http://${host}:${port}`)
    console.error('Is the server running? Try: openskelo start')
    process.exitCode = 1
  }
}

async function cmdAdd(flags: Record<string, string>): Promise<void> {
  const config = loadConfig(flags.config)
  const port = config.server?.port ?? 4820
  const host = config.server?.host ?? '127.0.0.1'

  let input = ''
  if (flags.file) {
    input = fs.readFileSync(flags.file, 'utf-8')
  } else {
    const chunks: Buffer[] = []
    for await (const chunk of process.stdin) {
      chunks.push(chunk as Buffer)
    }
    input = Buffer.concat(chunks).toString('utf-8')
  }

  try {
    const body = JSON.parse(input)
    const res = await fetch(`http://${host}:${port}/tasks`, {
      method: 'POST',
      headers: buildRequestHeaders(config.server?.api_key, true),
      body: JSON.stringify(body),
    })
    const task = await res.json() as Record<string, unknown>
    console.log(`Created task ${task.id} (${task.status})`)
    console.log(`  Type: ${task.type}`)
    console.log(`  Summary: ${task.summary}`)
  } catch (err) {
    console.error('Failed to add task:', (err as Error).message)
    process.exitCode = 1
  }
}

async function cmdList(flags: Record<string, string>): Promise<void> {
  const config = loadConfig(flags.config)
  const port = config.server?.port ?? 4820
  const host = config.server?.host ?? '127.0.0.1'

  try {
    let url = `http://${host}:${port}/tasks`
    if (flags.status) {
      url += `?status=${encodeURIComponent(flags.status)}`
    }

    const res = await fetch(url, {
      headers: buildRequestHeaders(config.server?.api_key),
    })
    const tasks = await res.json() as Array<Record<string, unknown>>

    if (tasks.length === 0) {
      console.log('No tasks found.')
      return
    }

    console.log(`${'ID'.padEnd(12)} ${'STATUS'.padEnd(14)} ${'TYPE'.padEnd(10)} SUMMARY`)
    console.log('-'.repeat(60))
    for (const task of tasks) {
      const id = String(task.id).slice(0, 10) + '..'
      const status = String(task.status).padEnd(14)
      const type = String(task.type).padEnd(10)
      const summary = String(task.summary).slice(0, 40)
      console.log(`${id} ${status} ${type} ${summary}`)
    }
    console.log(`\n${tasks.length} task(s)`)
  } catch {
    console.error(`Could not connect to OpenSkelo at http://${host}:${port}`)
    process.exitCode = 1
  }
}

async function main(): Promise<void> {
  const { command, flags } = parseArgs(process.argv)

  switch (command) {
    case 'init':
      return cmdInit()
    case 'start':
      return cmdStart(flags)
    case 'status':
      return cmdStatus(flags)
    case 'add':
      return cmdAdd(flags)
    case 'list':
      return cmdList(flags)
    default:
      printHelp()
  }
}

main().catch((err) => {
  console.error(err.message)
  process.exitCode = 1
})
