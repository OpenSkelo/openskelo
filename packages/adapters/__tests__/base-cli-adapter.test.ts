import { describe, it, expect, vi, beforeEach } from 'vitest'
import { BaseCliAdapter } from '../src/base-cli-adapter.js'
import type { TaskInput, AdapterResult, AdapterConfig } from '../src/types.js'
import * as os from 'node:os'
import * as path from 'node:path'
import * as fs from 'node:fs'

class TestAdapter extends BaseCliAdapter {
  buildPrompt(task: TaskInput): string {
    return task.prompt
  }

  parseOutput(stdout: string, stderr: string, exitCode: number, _task: TaskInput): AdapterResult {
    return {
      output: stdout,
      exit_code: exitCode,
      duration_ms: 0,
      structured: null,
    }
  }
}

function makeTask(overrides: Partial<TaskInput> = {}): TaskInput {
  return {
    id: 'test-1',
    type: 'code',
    summary: 'Test task',
    prompt: 'hello world',
    backend: 'test',
    ...overrides,
  }
}

describe('BaseCliAdapter', () => {
  let adapter: TestAdapter

  beforeEach(() => {
    adapter = new TestAdapter('test', ['code', 'refactor'])
  })

  it('spawns process and captures stdout (exit 0)', async () => {
    const result = await adapter.execute(
      makeTask({ prompt: 'hello', backend_config: { command: 'echo', args: ['hello'] } })
    )
    expect(result.output).toBe('hello\n')
    expect(result.exit_code).toBe(0)
  })

  it('captures non-zero exit code', async () => {
    const result = await adapter.execute(
      makeTask({ backend_config: { command: 'sh', args: ['-c', 'exit 42'] } })
    )
    expect(result.exit_code).toBe(42)
  })

  it('kills process after timeout_ms with exit code 124', async () => {
    const result = await adapter.execute(
      makeTask({ backend_config: { command: 'sleep', args: ['10'], timeout_ms: 200 } })
    )
    expect(result.exit_code).toBe(124)
  }, 5000)

  it('abort() kills a tracked process', async () => {
    const task = makeTask({
      id: 'abort-me',
      backend_config: { command: 'sleep', args: ['30'] },
    })
    const promise = adapter.execute(task)
    // Give the process a moment to start
    await new Promise(r => setTimeout(r, 100))
    await adapter.abort('abort-me')
    const result = await promise
    expect(result.exit_code).not.toBe(0)
  }, 5000)

  it('captures stderr', async () => {
    const stderrAdapter = new class extends BaseCliAdapter {
      buildPrompt(task: TaskInput) { return task.prompt }
      parseOutput(stdout: string, stderr: string, exitCode: number): AdapterResult {
        return { output: stdout, exit_code: exitCode, duration_ms: 0, structured: stderr || null }
      }
    }('stderr-test', ['code'])

    const result = await stderrAdapter.execute(
      makeTask({ backend_config: { command: 'sh', args: ['-c', 'echo err >&2'] } })
    )
    expect(result.structured).toBe('err\n')
  })

  it('appends timeout message to stderr when process times out', async () => {
    const stderrAdapter = new class extends BaseCliAdapter {
      buildPrompt(task: TaskInput) { return task.prompt }
      parseOutput(stdout: string, stderr: string, exitCode: number): AdapterResult {
        return { output: stdout, exit_code: exitCode, duration_ms: 0, structured: stderr || null }
      }
    }('stderr-timeout-test', ['code'])

    const result = await stderrAdapter.execute(
      makeTask({ backend_config: { command: 'sleep', args: ['10'], timeout_ms: 200 } })
    )

    expect(result.exit_code).toBe(124)
    expect(String(result.structured)).toContain('Process timed out')
  }, 5000)

  it('passes cwd to spawn', async () => {
    const tmpDir = os.tmpdir()
    const result = await adapter.execute(
      makeTask({ backend_config: { command: 'pwd', args: [], cwd: tmpDir } })
    )
    // Use realpathSync to handle /private/tmp symlink on macOS
    expect(fs.realpathSync(result.output.trim())).toBe(fs.realpathSync(tmpDir))
  })

  it('merges and passes env vars to spawn', async () => {
    const result = await adapter.execute(
      makeTask({
        backend_config: {
          command: 'sh',
          args: ['-c', 'echo $MY_TEST_VAR'],
          env: { MY_TEST_VAR: 'hello_env' },
        },
      })
    )
    expect(result.output.trim()).toBe('hello_env')
  })

  it('canHandle() returns true for matching backend name', () => {
    expect(adapter.canHandle(makeTask({ backend: 'test' }))).toBe(true)
  })

  it('canHandle() returns false for non-matching backend and type', () => {
    expect(adapter.canHandle(makeTask({ backend: 'other', type: 'deploy' }))).toBe(false)
  })

  it('canHandle() returns true for matching task type', () => {
    expect(adapter.canHandle(makeTask({ backend: 'other', type: 'code' }))).toBe(true)
  })

  it('tracks duration via performance.now()', async () => {
    const result = await adapter.execute(
      makeTask({ backend_config: { command: 'sleep', args: ['0.1'] } })
    )
    expect(result.duration_ms).toBeGreaterThan(50)
    expect(result.duration_ms).toBeLessThan(3000)
  })

  it('tracks multiple concurrent processes independently', async () => {
    const task1 = makeTask({
      id: 'concurrent-1',
      backend_config: { command: 'echo', args: ['one'] },
    })
    const task2 = makeTask({
      id: 'concurrent-2',
      backend_config: { command: 'echo', args: ['two'] },
    })
    const [r1, r2] = await Promise.all([adapter.execute(task1), adapter.execute(task2)])
    expect(r1.output.trim()).toBe('one')
    expect(r2.output.trim()).toBe('two')
  })

  it('removes process from tracking after completion', async () => {
    const task = makeTask({
      id: 'track-cleanup',
      backend_config: { command: 'echo', args: ['done'] },
    })
    await adapter.execute(task)
    // abort on a completed task should be a no-op (no error)
    await expect(adapter.abort('track-cleanup')).resolves.toBeUndefined()
  })

  it('merges default config with task backend_config', async () => {
    const adapterWithDefaults = new TestAdapter('test', ['code'], {
      command: 'echo',
      args: ['default'],
    })
    const result = await adapterWithDefaults.execute(
      makeTask({ backend_config: { args: ['override'] } })
    )
    // backend_config.args should override default args
    expect(result.output.trim()).toBe('override')
  })

  it('handles empty stdout gracefully', async () => {
    const result = await adapter.execute(
      makeTask({ backend_config: { command: 'true', args: [] } })
    )
    expect(result.output).toBe('')
    expect(result.exit_code).toBe(0)
  })

  it('handles spawn error (command not found) gracefully', async () => {
    const result = await adapter.execute(
      makeTask({ backend_config: { command: 'nonexistent_command_xyz_123', args: [] } })
    )
    expect(result.exit_code).not.toBe(0)
  })

  it('sets failure_code=timeout for exit code 124', async () => {
    const result = await adapter.execute(
      makeTask({ backend_config: { command: 'sleep', args: ['10'], timeout_ms: 200 } })
    )
    expect(result.exit_code).toBe(124)
    expect(result.failure_code).toBe('timeout')
  }, 5000)

  it('sets failure_code for non-zero exit code', async () => {
    const result = await adapter.execute(
      makeTask({ backend_config: { command: 'sh', args: ['-c', 'exit 1'] } })
    )
    expect(result.exit_code).toBe(1)
    expect(result.failure_code).toBeDefined()
  })

  it('does not set failure_code on success', async () => {
    const result = await adapter.execute(
      makeTask({ backend_config: { command: 'echo', args: ['ok'] } })
    )
    expect(result.exit_code).toBe(0)
    expect(result.failure_code).toBeUndefined()
  })
})
