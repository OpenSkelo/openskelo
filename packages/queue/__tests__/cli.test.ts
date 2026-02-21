import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import * as fs from 'node:fs'
import * as path from 'node:path'
import * as os from 'node:os'
import {
  parseArgs,
  generateTemplate,
  buildRequestHeaders,
  buildInlineTaskBody,
  buildBounceBody,
  buildRunBody,
  getMissingInlineFields,
  isInlineAddAttempt,
} from '../src/cli.js'

describe('CLI arg parsing', () => {
  it('parses "init" command', () => {
    const result = parseArgs(['node', 'openskelo', 'init'])
    expect(result.command).toBe('init')
  })

  it('parses "start" command', () => {
    const result = parseArgs(['node', 'openskelo', 'start'])
    expect(result.command).toBe('start')
  })

  it('parses "status" command', () => {
    const result = parseArgs(['node', 'openskelo', 'status'])
    expect(result.command).toBe('status')
  })

  it('parses "add" command', () => {
    const result = parseArgs(['node', 'openskelo', 'add'])
    expect(result.command).toBe('add')
  })

  it('parses "list" command', () => {
    const result = parseArgs(['node', 'openskelo', 'list'])
    expect(result.command).toBe('list')
  })

  it('parses "approve" command', () => {
    const result = parseArgs(['node', 'openskelo', 'approve'])
    expect(result.command).toBe('approve')
  })

  it('parses "bounce" command', () => {
    const result = parseArgs(['node', 'openskelo', 'bounce'])
    expect(result.command).toBe('bounce')
  })

  it('parses "doctor" command', () => {
    const result = parseArgs(['node', 'openskelo', 'doctor'])
    expect(result.command).toBe('doctor')
  })

  it('parses --config flag', () => {
    const result = parseArgs(['node', 'openskelo', 'start', '--config', './custom.yaml'])
    expect(result.command).toBe('start')
    expect(result.flags.config).toBe('./custom.yaml')
  })

  it('parses --status flag for list', () => {
    const result = parseArgs(['node', 'openskelo', 'list', '--status', 'PENDING'])
    expect(result.command).toBe('list')
    expect(result.flags.status).toBe('PENDING')
  })

  it('defaults to "help" for unknown command', () => {
    const result = parseArgs(['node', 'openskelo'])
    expect(result.command).toBe('help')
  })

  it('parses positional args for approve', () => {
    const result = parseArgs(['node', 'openskelo', 'approve', 'TASK-123'])
    expect(result.command).toBe('approve')
    expect(result.positionalArgs).toEqual(['TASK-123'])
  })

  it('parses positional args with flags for bounce', () => {
    const result = parseArgs([
      'node', 'openskelo', 'bounce', 'TASK-456',
      '--reason', 'Missing tests',
      '--where', 'src/auth.ts',
      '--fix', 'Add tests',
    ])
    expect(result.command).toBe('bounce')
    expect(result.positionalArgs).toEqual(['TASK-456'])
    expect(result.flags.reason).toBe('Missing tests')
    expect(result.flags.where).toBe('src/auth.ts')
    expect(result.flags.fix).toBe('Add tests')
  })

  it('captures dangling flags as empty string', () => {
    const result = parseArgs(['node', 'openskelo', 'add', '--type'])
    expect(result.flags.type).toBe('')
  })
})

describe('buildRequestHeaders', () => {
  it('includes x-api-key when configured', () => {
    const headers = buildRequestHeaders('secret-key', true)
    expect(headers['x-api-key']).toBe('secret-key')
    expect(headers['Content-Type']).toBe('application/json')
  })

  it('omits x-api-key when not configured', () => {
    const headers = buildRequestHeaders(undefined, false)
    expect(headers['x-api-key']).toBeUndefined()
    expect(headers['Content-Type']).toBeUndefined()
  })
})

describe('buildInlineTaskBody', () => {
  it('constructs correct task body from all flags', () => {
    const body = buildInlineTaskBody({
      type: 'code',
      summary: 'Fix login bug',
      prompt: 'Review src/auth/login.ts',
      backend: 'claude-code',
    })
    expect(body).toEqual({
      type: 'code',
      summary: 'Fix login bug',
      prompt: 'Review src/auth/login.ts',
      backend: 'claude-code',
      priority: 0,
    })
  })

  it('returns null when required flags are missing', () => {
    expect(buildInlineTaskBody({ type: 'code', summary: 'test' })).toBeNull()
    expect(buildInlineTaskBody({ type: 'code' })).toBeNull()
    expect(buildInlineTaskBody({})).toBeNull()
  })

  it('parses priority flag', () => {
    const body = buildInlineTaskBody({
      type: 'code',
      summary: 'Fix bug',
      prompt: 'Fix it',
      backend: 'claude-code',
      priority: '2',
    })
    expect(body!.priority).toBe(2)
  })

  it('all flags together produce valid CreateTaskInput', () => {
    const body = buildInlineTaskBody({
      type: 'code',
      summary: 'Refactor auth',
      prompt: 'Refactor src/auth.ts to use async/await',
      backend: 'claude-code',
      priority: '1',
    })
    expect(body).not.toBeNull()
    expect(body!.type).toBe('code')
    expect(body!.summary).toBe('Refactor auth')
    expect(body!.prompt).toBe('Refactor src/auth.ts to use async/await')
    expect(body!.backend).toBe('claude-code')
    expect(body!.priority).toBe(1)
  })

  it('reports missing inline flags', () => {
    const missing = getMissingInlineFields({ type: 'code', summary: 'Fix bug' })
    expect(missing).toEqual(['prompt', 'backend'])
  })

  it('detects inline add attempts', () => {
    expect(isInlineAddAttempt({ type: 'code' })).toBe(true)
    expect(isInlineAddAttempt({ priority: '1' })).toBe(true)
    expect(isInlineAddAttempt({ file: './task.json' })).toBe(false)
  })
})

describe('buildBounceBody', () => {
  it('constructs correct transition with feedback', () => {
    const body = buildBounceBody({
      reason: 'Missing error handling',
      where: 'src/auth.ts',
      fix: 'Add try/catch',
    })
    expect(body).toEqual({
      to: 'PENDING',
      feedback: {
        what: 'Missing error handling',
        where: 'src/auth.ts',
        fix: 'Add try/catch',
      },
    })
  })

  it('requires --reason flag', () => {
    expect(buildBounceBody({})).toBeNull()
    expect(buildBounceBody({ where: 'src/auth.ts' })).toBeNull()
  })

  it('defaults --where and --fix to empty string', () => {
    const body = buildBounceBody({ reason: 'Bad output' })
    expect(body!.feedback.where).toBe('')
    expect(body!.feedback.fix).toBe('')
  })

  it('includes --where and --fix when present', () => {
    const body = buildBounceBody({
      reason: 'Tests fail',
      where: 'test/auth.test.ts',
      fix: 'Fix assertion',
    })
    expect(body!.feedback.where).toBe('test/auth.test.ts')
    expect(body!.feedback.fix).toBe('Fix assertion')
  })
})

describe('CLI init', () => {
  let tmpDir: string

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'openskelo-cli-'))
  })

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  it('generates template with all config sections', () => {
    const template = generateTemplate()
    expect(template).toContain('db_path')
    expect(template).toContain('adapters')
    expect(template).toContain('wip_limits')
    expect(template).toContain('leases')
    expect(template).toContain('dispatcher')
    expect(template).toContain('watchdog')
    expect(template).toContain('server')
    expect(template).toContain('gates')
  })

  it('init creates openskelo.yaml', () => {
    const filePath = path.join(tmpDir, 'openskelo.yaml')
    expect(fs.existsSync(filePath)).toBe(false)
    fs.writeFileSync(filePath, generateTemplate())
    expect(fs.existsSync(filePath)).toBe(true)
  })

  it('template is valid YAML', async () => {
    const { parse } = await import('yaml')
    const template = generateTemplate()
    const parsed = parse(template)
    expect(parsed.db_path).toBeTruthy()
  })

  it('init aborts if file exists', () => {
    const filePath = path.join(tmpDir, 'openskelo.yaml')
    fs.writeFileSync(filePath, 'existing')
    expect(fs.existsSync(filePath)).toBe(true)
  })

  it('template includes chat_id in webhook example', () => {
    const template = generateTemplate()
    expect(template).toContain('chat_id')
  })

  it('template includes schedules section', () => {
    const template = generateTemplate()
    expect(template).toContain('schedules')
    expect(template).toContain('every: 24h')
  })
})

describe('CLI template and run commands', () => {
  it('parseArgs handles "template list" subcommand', () => {
    const result = parseArgs(['node', 'openskelo', 'template', 'list'])
    expect(result.command).toBe('template')
    expect(result.subcommand).toBe('list')
  })

  it('parseArgs handles "template save" with flags', () => {
    const result = parseArgs([
      'node', 'openskelo', 'template', 'save',
      '--name', 'my-tpl',
      '--type', 'task',
      '--definition', '{"type":"code"}',
    ])
    expect(result.command).toBe('template')
    expect(result.subcommand).toBe('save')
    expect(result.flags.name).toBe('my-tpl')
    expect(result.flags.type).toBe('task')
  })

  it('parseArgs handles "template show" with positional arg', () => {
    const result = parseArgs(['node', 'openskelo', 'template', 'show', 'my-tpl'])
    expect(result.command).toBe('template')
    expect(result.subcommand).toBe('show')
    expect(result.positionalArgs).toEqual(['my-tpl'])
  })

  it('parseArgs handles "template delete" with positional arg', () => {
    const result = parseArgs(['node', 'openskelo', 'template', 'delete', 'my-tpl'])
    expect(result.command).toBe('template')
    expect(result.subcommand).toBe('delete')
    expect(result.positionalArgs).toEqual(['my-tpl'])
  })

  it('parseArgs handles "run" command with --var flags', () => {
    const result = parseArgs([
      'node', 'openskelo', 'run', 'my-review',
      '--var', 'module=auth',
      '--var', 'file=src/auth.ts',
    ])
    expect(result.command).toBe('run')
    expect(result.positionalArgs).toEqual(['my-review'])
    expect(result.varFlags).toEqual({ module: 'auth', file: 'src/auth.ts' })
  })

  it('parseArgs "run" with --var and regular flags', () => {
    const result = parseArgs([
      'node', 'openskelo', 'run', 'tpl-name',
      '--var', 'key=value',
      '--config', './custom.yaml',
    ])
    expect(result.command).toBe('run')
    expect(result.positionalArgs).toEqual(['tpl-name'])
    expect(result.varFlags).toEqual({ key: 'value' })
    expect(result.flags.config).toBe('./custom.yaml')
  })

  it('buildRunBody extracts variables from varFlags', () => {
    const body = buildRunBody(
      { module: 'auth', file: 'src/auth.ts' },
      {},
    )
    expect(body.variables).toEqual({ module: 'auth', file: 'src/auth.ts' })
    expect(body.overrides).toBeUndefined()
  })

  it('buildRunBody extracts overrides from flags', () => {
    const body = buildRunBody(
      {},
      { 'override-summary': 'New summary', 'override-priority': '5' },
    )
    expect(body.variables).toBeUndefined()
    expect(body.overrides).toEqual({ summary: 'New summary', priority: 5 })
  })

  it('buildRunBody combines variables and overrides', () => {
    const body = buildRunBody(
      { key: 'value' },
      { 'override-summary': 'Custom' },
    )
    expect(body.variables).toEqual({ key: 'value' })
    expect(body.overrides).toEqual({ summary: 'Custom' })
  })
})
