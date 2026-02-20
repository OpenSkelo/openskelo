import { describe, it, expect } from 'vitest'
import { CodexAdapter } from '../src/adapters/codex.js'
import type { TaskInput } from '../src/types.js'

function makeTask(overrides: Partial<TaskInput> = {}): TaskInput {
  return {
    id: 'codex-1',
    type: 'code',
    summary: 'Refactor auth module',
    prompt: 'Extract the auth logic into a separate service.',
    backend: 'codex',
    ...overrides,
  }
}

describe('CodexAdapter', () => {
  const adapter = new CodexAdapter()

  it('buildPrompt includes task summary and prompt', () => {
    const result = adapter.buildPrompt(makeTask())
    expect(result).toContain('Task: Refactor auth module')
    expect(result).toContain('Extract the auth logic')
  })

  it('buildPrompt includes retry context', () => {
    const result = adapter.buildPrompt(
      makeTask({
        retry_context: { attempt: 2, feedback: 'Missing tests', failures: [] },
      })
    )
    expect(result).toContain('Previous Attempt Failed')
    expect(result).toContain('Missing tests')
  })

  it('parseOutput captures stdout', () => {
    const result = adapter.parseOutput('code output here', '', 0, makeTask())
    expect(result.output).toBe('code output here')
    expect(result.exit_code).toBe(0)
  })

  it('execute pipes built prompt to child process stdin', async () => {
    const task = makeTask({
      summary: 'Codex stdin test',
      prompt: 'stdin payload from codex adapter',
      backend_config: { command: 'cat', args: [] },
    })

    const result = await adapter.execute(task)

    expect(result.output).toContain('Task: Codex stdin test')
    expect(result.output).toContain('stdin payload from codex adapter')
    expect(result.exit_code).toBe(0)
  })

  it('canHandle returns true for backend codex', () => {
    expect(adapter.canHandle(makeTask())).toBe(true)
  })

  it('default command is codex', () => {
    expect(adapter.name).toBe('codex')
  })
})
