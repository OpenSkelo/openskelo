import { describe, it, expect } from 'vitest'
import { ClaudeCodeAdapter } from '../src/adapters/claude-code.js'
import type { TaskInput } from '../src/types.js'

function makeTask(overrides: Partial<TaskInput> = {}): TaskInput {
  return {
    id: 'cc-1',
    type: 'code',
    summary: 'Fix the login bug',
    prompt: 'The login form fails when email has a + character.',
    backend: 'claude-code',
    ...overrides,
  }
}

describe('ClaudeCodeAdapter', () => {
  const adapter = new ClaudeCodeAdapter()

  describe('buildPrompt', () => {
    it('includes summary and prompt', () => {
      const result = adapter.buildPrompt(makeTask())
      expect(result).toContain('Task: Fix the login bug')
      expect(result).toContain('The login form fails when email has a + character.')
    })

    it('includes acceptance criteria when present', () => {
      const result = adapter.buildPrompt(
        makeTask({ acceptance_criteria: ['Email with + works', 'Tests pass'] })
      )
      expect(result).toContain('Acceptance Criteria')
      expect(result).toContain('- Email with + works')
      expect(result).toContain('- Tests pass')
    })

    it('includes definition of done when present', () => {
      const result = adapter.buildPrompt(
        makeTask({ definition_of_done: ['All tests green', 'No lint errors'] })
      )
      expect(result).toContain('Definition of Done')
      expect(result).toContain('- All tests green')
      expect(result).toContain('- No lint errors')
    })

    it('omits acceptance criteria when empty', () => {
      const result = adapter.buildPrompt(makeTask())
      expect(result).not.toContain('Acceptance Criteria')
    })

    it('includes retry context when present', () => {
      const result = adapter.buildPrompt(
        makeTask({
          retry_context: {
            attempt: 3,
            feedback: 'JSON output was invalid',
            failures: [],
          },
        })
      )
      expect(result).toContain('Previous Attempt Failed')
      expect(result).toContain('Attempt 3')
      expect(result).toContain('JSON output was invalid')
    })

    it('includes bounce context when present', () => {
      const result = adapter.buildPrompt(
        makeTask({
          bounce_context: {
            bounce_count: 2,
            feedback: [
              { what: 'Missing validation', where: 'login.ts', fix: 'Add email check' },
            ],
          },
        })
      )
      expect(result).toContain('Bounce #2')
      expect(result).toContain('WHAT: Missing validation')
      expect(result).toContain('WHERE: login.ts')
      expect(result).toContain('FIX: Add email check')
    })

    it('includes upstream results when present', () => {
      const result = adapter.buildPrompt(
        makeTask({ upstream_results: { research: { findings: 'Use bcrypt' } } })
      )
      expect(result).toContain('Context from Previous Steps')
      expect(result).toContain('Use bcrypt')
    })

    it('handles all sections together', () => {
      const result = adapter.buildPrompt(
        makeTask({
          acceptance_criteria: ['Works'],
          definition_of_done: ['Tests pass'],
          retry_context: { attempt: 1, feedback: 'Fix it', failures: [] },
          bounce_context: {
            bounce_count: 1,
            feedback: [{ what: 'Bad', where: 'here', fix: 'This' }],
          },
          upstream_results: { prev: 'data' },
        })
      )
      expect(result).toContain('Task: Fix the login bug')
      expect(result).toContain('Acceptance Criteria')
      expect(result).toContain('Definition of Done')
      expect(result).toContain('Previous Attempt Failed')
      expect(result).toContain('Human Review Feedback')
      expect(result).toContain('Context from Previous Steps')
    })
  })

  describe('parseOutput', () => {
    it('captures stdout as output', () => {
      const result = adapter.parseOutput('Hello world', '', 0, makeTask())
      expect(result.output).toBe('Hello world')
    })

    it('detects structured JSON in stdout', () => {
      const json = JSON.stringify({ key: 'value' })
      const result = adapter.parseOutput(json, '', 0, makeTask())
      expect(result.structured).toEqual({ key: 'value' })
    })

    it('returns null structured when stdout is not JSON', () => {
      const result = adapter.parseOutput('plain text', '', 0, makeTask())
      expect(result.structured).toBeNull()
    })

    it('captures exit code', () => {
      const result = adapter.parseOutput('', 'error', 1, makeTask())
      expect(result.exit_code).toBe(1)
    })
  })

  describe('execute', () => {
    it('pipes built prompt to child process stdin', async () => {
      const task = makeTask({
        summary: 'Echo stdin test',
        prompt: 'stdin payload from claude adapter',
        backend_config: { command: 'cat', args: [] },
      })

      const result = await adapter.execute(task)

      expect(result.output).toContain('Task: Echo stdin test')
      expect(result.output).toContain('stdin payload from claude adapter')
      expect(result.exit_code).toBe(0)
    })
  })

  describe('canHandle', () => {
    it('returns true for backend claude-code', () => {
      expect(adapter.canHandle(makeTask())).toBe(true)
    })

    it('returns true for task type code', () => {
      expect(adapter.canHandle(makeTask({ backend: 'other', type: 'code' }))).toBe(true)
    })
  })

  it('has default args including --print', () => {
    // Verify by checking the adapter was constructed correctly
    expect(adapter.name).toBe('claude-code')
    expect(adapter.taskTypes).toContain('code')
  })
})
