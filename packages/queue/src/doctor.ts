import * as fs from 'node:fs'
import { execSync } from 'node:child_process'
import * as net from 'node:net'

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

export function checkSqliteModule(): DoctorCheck {
  try {
    require('better-sqlite3')
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
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { parse } = require('yaml') as { parse: (s: string) => unknown }
    const raw = fs.readFileSync(configPath, 'utf-8')
    const parsed = parse(raw) as Record<string, unknown>
    if (!parsed.db_path) {
      return { label: 'Config', ok: false, detail: `${configPath} missing db_path` }
    }
    return { label: 'Config', ok: true, detail: `${configPath} valid` }
  } catch (err) {
    return { label: 'Config', ok: false, detail: `${configPath} parse error: ${(err as Error).message}` }
  }
}

export function checkCommand(name: string, command: string): DoctorCheck {
  try {
    const result = execSync(`which ${command}`, { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }).trim()
    return { label: `Adapter ${name}`, ok: true, detail: `${command} found at ${result}` }
  } catch {
    return { label: `Adapter ${name}`, ok: false, detail: `${command} not found on PATH` }
  }
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
    const { parse } = require('yaml') as { parse: (s: string) => unknown }
    const raw = fs.readFileSync(configPath, 'utf-8')
    const parsed = parse(raw) as { adapters?: Array<{ name: string; command?: string; type?: string }> }
    if (!parsed.adapters) return []

    return parsed.adapters
      .filter(a => a.type === 'cli')
      .map(a => ({
        name: a.name,
        command: a.command ?? KNOWN_ADAPTER_COMMANDS[a.name] ?? a.name,
      }))
  } catch {
    return []
  }
}

export async function runDoctor(configPath: string, port: number): Promise<DoctorCheck[]> {
  const checks: DoctorCheck[] = []

  checks.push(checkNodeVersion())
  checks.push(checkSqliteModule())
  checks.push(checkConfigFile(configPath))

  const adapters = extractAdapterCommands(configPath)
  for (const adapter of adapters) {
    checks.push(checkCommand(adapter.name, adapter.command))
  }

  checks.push(await checkPort(port))

  return checks
}
