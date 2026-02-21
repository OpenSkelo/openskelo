import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import * as fs from 'node:fs'
import * as path from 'node:path'
import * as os from 'node:os'
import {
  checkNodeVersion,
  checkSqliteModule,
  checkCommand,
  checkConfigFile,
  checkPort,
  extractAdapterCommands,
  runDoctor,
} from '../src/doctor.js'

describe('doctor checks', () => {
  let tmpDir: string

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'openskelo-doctor-'))
  })

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  it('checks Node version >= 18', () => {
    const result = checkNodeVersion()
    expect(result.ok).toBe(true)
    expect(result.detail).toContain('Node')
  })

  it('checks sqlite module import', async () => {
    const result = await checkSqliteModule()
    expect(result.label).toBe('SQLite')
  })

  it('reports missing command', () => {
    const result = checkCommand('nonexistent', 'totally_fake_command_xyz')
    expect(result.ok).toBe(false)
    expect(result.detail).toContain('not found on PATH')
  })

  it('does not execute shell metacharacters in command checks', () => {
    const markerPath = path.join(tmpDir, 'should-not-exist')
    const result = checkCommand('unsafe', `node; touch ${markerPath}`)
    expect(result.ok).toBe(false)
    expect(fs.existsSync(markerPath)).toBe(false)
  })

  it('reports found command', () => {
    const result = checkCommand('node', 'node')
    expect(result.ok).toBe(true)
    expect(result.detail).toContain('found at')
  })

  it('reports config not found', () => {
    const result = checkConfigFile('/nonexistent/openskelo.yaml')
    expect(result.ok).toBe(false)
    expect(result.detail).toContain('not found')
  })

  it('reports valid config', () => {
    const configPath = path.join(tmpDir, 'openskelo.yaml')
    fs.writeFileSync(configPath, `
db_path: ./test.db
adapters:
  - name: shell
    type: cli
    task_types: [script]
`)
    const result = checkConfigFile(configPath)
    expect(result.ok).toBe(true)
    expect(result.detail).toContain('valid')
  })

  it('reports config missing db_path', () => {
    const configPath = path.join(tmpDir, 'openskelo.yaml')
    fs.writeFileSync(configPath, 'adapters: []')
    const result = checkConfigFile(configPath)
    expect(result.ok).toBe(false)
    expect(result.detail).toContain('db_path')
  })

  it('fails config check when env variable substitution is missing', () => {
    const configPath = path.join(tmpDir, 'openskelo.yaml')
    fs.writeFileSync(configPath, `
db_path: ./test.db
adapters:
  - name: shell
    type: cli
    task_types: [script]
server:
  api_key: \${MISSING_ENV_FOR_DOCTOR}
`)
    const result = checkConfigFile(configPath)
    expect(result.ok).toBe(false)
    expect(result.detail).toContain('MISSING_ENV_FOR_DOCTOR')
  })

  it('checks port availability', async () => {
    const result = await checkPort(0) // port 0 = OS picks random free port
    // This should succeed since we're asking for any free port
    expect(result.label).toBe('Port')
  })

  it('extracts adapter commands from config', () => {
    const configPath = path.join(tmpDir, 'openskelo.yaml')
    fs.writeFileSync(configPath, `
db_path: ./test.db
adapters:
  - name: claude-code
    type: cli
    task_types: [code]
  - name: shell
    type: cli
    task_types: [script]
  - name: raw-api
    type: api
    task_types: [chat]
`)
    const adapters = extractAdapterCommands(configPath)
    expect(adapters).toHaveLength(2) // only cli type
    expect(adapters[0]).toEqual({ name: 'claude-code', command: 'claude' })
    expect(adapters[1]).toEqual({ name: 'shell', command: 'sh' })
  })

  it('runDoctor returns array of checks', async () => {
    const configPath = path.join(tmpDir, 'openskelo.yaml')
    fs.writeFileSync(configPath, `
db_path: ./test.db
adapters:
  - name: shell
    type: cli
    task_types: [script]
`)
    const checks = await runDoctor(configPath, 0)
    expect(checks.length).toBeGreaterThanOrEqual(4) // node, sqlite, config, adapter, port
    expect(checks[0].label).toBe('Node.js')
  })
})
