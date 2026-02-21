import * as fs from 'node:fs'
import { spawnSync } from 'node:child_process'
import * as net from 'node:net'
import { parse as parseYaml } from 'yaml'
import { loadConfig } from './config.js'

export interface DoctorCheck {
  label: string
  ok: boolean
  detail: string
}

export function checkNodeVersion(): DoctorCheck {
  const major = parseInt(process.version.slice(1), 10)
  return {
    label: 'Node.js',
    ok: major >= 18,
    detail: major >= 18
      ? `Node ${process.version}`
      : `Node ${process.version} — requires >= 18`,
  }
}

export async function checkSqliteModule(): Promise<DoctorCheck> {
  try {
    await import('better-sqlite3')
    return { label: 'SQLite', ok: true, detail: 'better-sqlite3 native module OK' }
  } catch {
    return { label: 'SQLite', ok: false, detail: 'better-sqlite3 failed to load — run npm rebuild' }
  }
}

export function checkConfigFile(configPath: string): DoctorCheck {
  if (!fs.existsSync(configPath)) {
    return { label: 'Config', ok: false, detail: `${configPath} not found` }
  }

  try {
    loadConfig(configPath)
    return { label: 'Config', ok: true, detail: `${configPath} valid` }
  } catch (err) {
    return { label: 'Config', ok: false, detail: `${configPath} invalid: ${(err as Error).message}` }
  }
}

export function checkCommand(name: string, command: string): DoctorCheck {
  const trimmed = command.trim()
  if (!trimmed) {
    return { label: `Adapter ${name}`, ok: false, detail: `${name} command is empty` }
  }

  const result = spawnSync('which', [trimmed], {
    encoding: 'utf-8',
    stdio: 'pipe',
    shell: false,
  })

  if (result.status === 0) {
    return {
      label: `Adapter ${name}`,
      ok: true,
      detail: `${trimmed} found at ${result.stdout.trim()}`,
    }
  }

  return { label: `Adapter ${name}`, ok: false, detail: `${trimmed} not found on PATH` }
}

export function checkPort(port: number): Promise<DoctorCheck> {
  return new Promise((resolve) => {
    const server = net.createServer()
    server.once('error', () => {
      resolve({ label: 'Port', ok: false, detail: `Port ${port} is in use` })
    })
    server.listen(port, '127.0.0.1', () => {
      server.close(() => {
        resolve({ label: 'Port', ok: true, detail: `Port ${port} available` })
      })
    })
  })
}

export interface AdapterInfo {
  name: string
  command: string
}

const KNOWN_ADAPTER_COMMANDS: Record<string, string> = {
  'claude-code': 'claude',
  'codex': 'codex',
  'aider': 'aider',
  'shell': 'sh',
}

export function extractAdapterCommands(configPath: string): AdapterInfo[] {
  try {
    const raw = fs.readFileSync(configPath, 'utf-8')
    const parsed = parseYaml(raw) as { adapters?: Array<{ name: string; command?: string; type?: string }> }
    if (!parsed.adapters) return []

    return parsed.adapters
      .filter((adapter) => adapter.type === 'cli')
      .map((adapter) => ({
        name: adapter.name,
        command: adapter.command ?? KNOWN_ADAPTER_COMMANDS[adapter.name] ?? adapter.name,
      }))
  } catch {
    return []
  }
}

export async function runDoctor(configPath: string, port: number): Promise<DoctorCheck[]> {
  const checks: DoctorCheck[] = []

  checks.push(checkNodeVersion())
  checks.push(await checkSqliteModule())
  checks.push(checkConfigFile(configPath))

  const adapters = extractAdapterCommands(configPath)
  for (const adapter of adapters) {
    checks.push(checkCommand(adapter.name, adapter.command))
  }

  checks.push(await checkPort(port))

  return checks
}
