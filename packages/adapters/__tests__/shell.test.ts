import { describe, it, expect } from 'vitest'
import { ShellAdapter } from '../src/adapters/shell.js'
import type { TaskInput } from '../src/types.js'
import * as os from 'node:os'
import * as fs from 'node:fs'

function makeTask(overrides: Partial<TaskInput> = {}): TaskInput {
  return {
    id: 'sh-1',
    type: 'script',
    summary: 'Run a shell command',
    prompt: 'echo hello',
    backend: 'shell',
    ...overrides,
  }
}

describe('ShellAdapter', () => {
  const adapter = new ShellAdapter()

  it('buildPrompt returns task.prompt as-is', () => {
    const result = adapter.buildPrompt(makeTask({ prompt: 'ls -la' }))
    expect(result).toBe('ls -la')
  })

  it('parseOutput captures stdout', () => {
    const result = adapter.parseOutput('file1\nfile2\n', '', 0, makeTask())
    expect(result.output).toBe('file1\nfile2\n')
  })

  it('parseOutput includes stderr on non-zero exit', () => {
    const result = adapter.parseOutput('', 'command not found', 127, makeTask())
    expect(result.output).toContain('command not found')
    expect(result.exit_code).toBe(127)
  })

  it('execute runs simple shell command', async () => {
    const result = await adapter.execute(makeTask({ prompt: 'echo hello' }))
    expect(result.output.trim()).toBe('hello')
    expect(result.exit_code).toBe(0)
  })

  it('execute captures exit code', async () => {
    const result = await adapter.execute(makeTask({ prompt: 'exit 42' }))
    expect(result.exit_code).toBe(42)
  })

  it('execute respects cwd', async () => {
    const tmpDir = os.tmpdir()
    const result = await adapter.execute(
      makeTask({ prompt: 'pwd', backend_config: { cwd: tmpDir } })
    )
    expect(fs.realpathSync(result.output.trim())).toBe(fs.realpathSync(tmpDir))
  })

  it('execute passes env vars', async () => {
    const result = await adapter.execute(
      makeTask({
        prompt: 'echo $SHELL_TEST_VAR',
        backend_config: { env: { SHELL_TEST_VAR: 'works' } },
      })
    )
    expect(result.output.trim()).toBe('works')
  })

  it('handles command that outputs to stderr', async () => {
    const result = await adapter.execute(
      makeTask({ prompt: 'echo err >&2 && exit 1' })
    )
    expect(result.output).toContain('err')
    expect(result.exit_code).toBe(1)
  })

  it('canHandle returns true for backend shell', () => {
    expect(adapter.canHandle(makeTask())).toBe(true)
  })

  it('canHandle returns true for task type script', () => {
    expect(adapter.canHandle(makeTask({ backend: 'other', type: 'script' }))).toBe(true)
  })
})
