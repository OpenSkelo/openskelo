import * as fs from 'node:fs'
import * as path from 'node:path'
import { loadConfig } from './config.js'
import { createQueue } from './factory.js'
import { runDoctor } from './doctor.js'

export interface ParsedArgs {
  command: string
  positionalArgs: string[]
  flags: Record<string, string>
}

const VALID_COMMANDS = ['init', 'start', 'status', 'add', 'list', 'approve', 'bounce', 'doctor', 'help']

export function parseArgs(argv: string[]): ParsedArgs {
  const args = argv.slice(2)
  const command = args[0] ?? 'help'
  const flags: Record<string, string> = {}
  const positionalArgs: string[] = []

  for (let i = 1; i < args.length; i++) {
    const arg = args[i]

    if (arg.startsWith('--')) {
      const key = arg.slice(2)
      const next = args[i + 1]
      if (next && !next.startsWith('--')) {
        flags[key] = next
        i++
      } else {
        flags[key] = ''
      }
      continue
    }

    positionalArgs.push(arg)
  }

  return {
    command: VALID_COMMANDS.includes(command) ? command : 'help',
    positionalArgs,
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
  if (includeJson) headers['Content-Type'] = 'application/json'
  if (apiKey) headers['x-api-key'] = apiKey
  return headers
}

const INLINE_ADD_FIELDS = ['type', 'summary', 'prompt', 'backend'] as const

export function getMissingInlineFields(flags: Record<string, string>): string[] {
  return INLINE_ADD_FIELDS.filter((field) => !flags[field])
}

export function isInlineAddAttempt(flags: Record<string, string>): boolean {
  return [...INLINE_ADD_FIELDS, 'priority'].some((field) => field in flags)
}

export function buildInlineTaskBody(flags: Record<string, string>): Record<string, unknown> | null {
  const missing = getMissingInlineFields(flags)
  if (missing.length > 0) return null

  return {
    type: flags.type,
    summary: flags.summary,
    prompt: flags.prompt,
    backend: flags.backend,
    priority: flags.priority ? parseInt(flags.priority, 10) : 0,
  }
}

export function buildBounceBody(flags: Record<string, string>): {
  to: string
  feedback: { what: string; where: string; fix: string }
} | null {
  if (!flags.reason) return null
  return {
    to: 'PENDING',
    feedback: {
      what: flags.reason,
      where: flags.where ?? '',
      fix: flags.fix ?? '',
    },
  }
}

async function parseErrorMessage(res: Response): Promise<string> {
  try {
    const body = await res.json() as { error?: string; message?: string }
    return body.error ?? body.message ?? `${res.status} ${res.statusText}`
  } catch {
    return `${res.status} ${res.statusText}`
  }
}

function printHelp(): void {
  console.log(`
OpenSkelo — AI Task Orchestrator

Usage:
  openskelo init                     Create openskelo.yaml template
  openskelo start [--config path]    Start queue, dispatcher, and API server
  openskelo status [--config path]   Show queue health status
  openskelo add [--config path]      Add task from stdin JSON or inline flags
  openskelo list [--config path]     List tasks (--status to filter)
  openskelo approve <task-id>        Approve a task in REVIEW → DONE
  openskelo bounce <task-id>         Bounce a task in REVIEW → PENDING
  openskelo doctor                   Check system readiness
  openskelo help                     Show this help

Add (inline):
  openskelo add --type code --summary "Fix bug" --prompt "Fix auth" --backend claude-code

Bounce:
  openskelo bounce <id> --reason "Missing tests" --where "src/auth.ts" --fix "Add unit tests"

Options:
  --config path     Path to config file (default: ./openskelo.yaml)
  --status STATUS   Filter tasks by status
  --priority N      Task priority (default: 0)
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

    if (!res.ok) {
      const error = await parseErrorMessage(res)
      console.error(`Status check failed: ${error}`)
      process.exitCode = 1
      return
    }

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

  let body: Record<string, unknown>

  const inlineAttempt = isInlineAddAttempt(flags)
  const missingInlineFields = getMissingInlineFields(flags)
  if (inlineAttempt && missingInlineFields.length > 0 && !flags.file) {
    console.error(`Missing required inline flags: ${missingInlineFields.map(field => `--${field}`).join(', ')}`)
    process.exitCode = 1
    return
  }

  const inline = buildInlineTaskBody(flags)
  if (inline) {
    body = inline
  } else if (flags.file) {
    body = JSON.parse(fs.readFileSync(flags.file, 'utf-8'))
  } else {
    const chunks: Buffer[] = []
    for await (const chunk of process.stdin) {
      chunks.push(chunk as Buffer)
    }
    body = JSON.parse(Buffer.concat(chunks).toString('utf-8'))
  }

  try {
    const res = await fetch(`http://${host}:${port}/tasks`, {
      method: 'POST',
      headers: buildRequestHeaders(config.server?.api_key, true),
      body: JSON.stringify(body),
    })

    if (!res.ok) {
      const error = await parseErrorMessage(res)
      console.error(`Failed to add task: ${error}`)
      process.exitCode = 1
      return
    }

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
    if (flags.status) url += `?status=${encodeURIComponent(flags.status)}`

    const res = await fetch(url, {
      headers: buildRequestHeaders(config.server?.api_key),
    })

    if (!res.ok) {
      const error = await parseErrorMessage(res)
      console.error(`List failed: ${error}`)
      process.exitCode = 1
      return
    }

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

async function cmdApprove(positionalArgs: string[], flags: Record<string, string>): Promise<void> {
  const taskId = positionalArgs[0]
  if (!taskId) {
    console.error('Usage: openskelo approve <task-id>')
    process.exitCode = 1
    return
  }

  const config = loadConfig(flags.config)
  const port = config.server?.port ?? 4820
  const host = config.server?.host ?? '127.0.0.1'
  const apiKey = config.server?.api_key

  try {
    const getRes = await fetch(`http://${host}:${port}/tasks/${taskId}`, {
      headers: buildRequestHeaders(apiKey),
    })
    if (!getRes.ok) {
      console.error(`Task ${taskId} not found`)
      process.exitCode = 1
      return
    }

    const task = await getRes.json() as Record<string, unknown>
    if (task.status !== 'REVIEW') {
      console.error(`Task ${taskId} is in ${task.status}, can only approve from REVIEW`)
      process.exitCode = 1
      return
    }

    const transRes = await fetch(`http://${host}:${port}/tasks/${taskId}/transition`, {
      method: 'POST',
      headers: buildRequestHeaders(apiKey, true),
      body: JSON.stringify({ to: 'DONE' }),
    })

    if (!transRes.ok) {
      const err = await transRes.json() as { error: string }
      console.error(`Failed to approve: ${err.error}`)
      process.exitCode = 1
      return
    }

    console.log(`Task ${taskId} approved`)
  } catch {
    console.error(`Could not connect to OpenSkelo at http://${host}:${port}`)
    process.exitCode = 1
  }
}

async function cmdBounce(positionalArgs: string[], flags: Record<string, string>): Promise<void> {
  const taskId = positionalArgs[0]
  if (!taskId) {
    console.error('Usage: openskelo bounce <task-id> --reason "..."')
    process.exitCode = 1
    return
  }

  const body = buildBounceBody(flags)
  if (!body) {
    console.error('--reason is required for bounce')
    process.exitCode = 1
    return
  }

  const config = loadConfig(flags.config)
  const port = config.server?.port ?? 4820
  const host = config.server?.host ?? '127.0.0.1'
  const apiKey = config.server?.api_key

  try {
    const getRes = await fetch(`http://${host}:${port}/tasks/${taskId}`, {
      headers: buildRequestHeaders(apiKey),
    })
    if (!getRes.ok) {
      console.error(`Task ${taskId} not found`)
      process.exitCode = 1
      return
    }

    const task = await getRes.json() as Record<string, unknown>
    if (task.status !== 'REVIEW') {
      console.error(`Task ${taskId} is in ${task.status}, can only bounce from REVIEW`)
      process.exitCode = 1
      return
    }

    const transRes = await fetch(`http://${host}:${port}/tasks/${taskId}/transition`, {
      method: 'POST',
      headers: buildRequestHeaders(apiKey, true),
      body: JSON.stringify(body),
    })

    if (!transRes.ok) {
      const err = await transRes.json() as { error: string }
      console.error(`Failed to bounce: ${err.error}`)
      process.exitCode = 1
      return
    }

    const updated = await transRes.json() as Record<string, unknown>
    console.log(`Task ${taskId} bounced -> PENDING (bounce #${updated.bounce_count})`)
  } catch {
    console.error(`Could not connect to OpenSkelo at http://${host}:${port}`)
    process.exitCode = 1
  }
}

async function cmdDoctor(flags: Record<string, string>): Promise<void> {
  const configPath = flags.config ?? path.join(process.cwd(), 'openskelo.yaml')
  let port = 4820

  try {
    const config = loadConfig(configPath)
    port = config.server?.port ?? 4820
  } catch {
    // Config may not exist yet — doctor will report it
  }

  const checks = await runDoctor(configPath, port)

  for (const check of checks) {
    const icon = check.ok ? '\u2713' : '\u2717'
    console.log(`${icon} ${check.detail}`)
  }

  const failed = checks.filter(c => !c.ok)
  if (failed.length > 0) {
    console.log(`\n${failed.length} issue(s) found`)
    process.exitCode = 1
  } else {
    console.log('\nAll checks passed')
  }
}

async function main(): Promise<void> {
  const { command, positionalArgs, flags } = parseArgs(process.argv)

  switch (command) {
    case 'init': return cmdInit()
    case 'start': return cmdStart(flags)
    case 'status': return cmdStatus(flags)
    case 'add': return cmdAdd(flags)
    case 'list': return cmdList(flags)
    case 'approve': return cmdApprove(positionalArgs, flags)
    case 'bounce': return cmdBounce(positionalArgs, flags)
    case 'doctor': return cmdDoctor(flags)
    default: printHelp()
  }
}

main().catch((err) => {
  console.error(err.message)
  process.exitCode = 1
})
