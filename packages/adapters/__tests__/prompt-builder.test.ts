import { describe, it, expect } from 'vitest'
import { buildTaskPrompt } from '../src/utils/prompt-builder.js'
import type { TaskInput } from '../src/types.js'

const minimal: TaskInput = {
  id: 'task-1',
  type: 'code',
  summary: 'Add login form',
  prompt: 'Create a React login form with email and password fields.',
  backend: 'claude-code',
}

describe('buildTaskPrompt', () => {
  it('includes summary and prompt for minimal task', () => {
    const result = buildTaskPrompt(minimal)
    expect(result).toContain('Task: Add login form')
    expect(result).toContain('Create a React login form')
  })

  it('includes all sections when present', () => {
    const full: TaskInput = {
      ...minimal,
      acceptance_criteria: ['Has email field', 'Has password field'],
      definition_of_done: ['Tests pass', 'No lint errors'],
      retry_context: {
        attempt: 2,
        feedback: 'Missing password validation',
        failures: [],
      },
      bounce_context: {
        bounce_count: 1,
        feedback: [
          { what: 'No error states', where: 'LoginForm.tsx', fix: 'Add error display' },
        ],
      },
      upstream_results: { auth: { endpoint: '/api/login' } },
    }
    const result = buildTaskPrompt(full)
    expect(result).toContain('Task: Add login form')
    expect(result).toContain('Has email field')
    expect(result).toContain('Has password field')
    expect(result).toContain('Tests pass')
    expect(result).toContain('No lint errors')
    expect(result).toContain('Missing password validation')
    expect(result).toContain('No error states')
    expect(result).toContain('/api/login')
  })

  it('omits empty sections', () => {
    const result = buildTaskPrompt(minimal)
    expect(result).not.toContain('Acceptance Criteria')
    expect(result).not.toContain('Definition of Done')
    expect(result).not.toContain('Previous Attempt Failed')
    expect(result).not.toContain('Human Review Feedback')
    expect(result).not.toContain('Context from Previous Steps')
  })

  it('formats acceptance criteria as bullet list', () => {
    const task: TaskInput = {
      ...minimal,
      acceptance_criteria: ['Criterion A', 'Criterion B'],
    }
    const result = buildTaskPrompt(task)
    expect(result).toContain('- Criterion A')
    expect(result).toContain('- Criterion B')
  })

  it('formats bounce feedback correctly', () => {
    const task: TaskInput = {
      ...minimal,
      bounce_context: {
        bounce_count: 2,
        feedback: [
          { what: 'Missing tests', where: 'src/auth.ts', fix: 'Add unit tests' },
          { what: 'Bad naming', where: 'src/utils.ts', fix: 'Use camelCase' },
        ],
      },
    }
    const result = buildTaskPrompt(task)
    expect(result).toContain('Bounce #2')
    expect(result).toContain('WHAT: Missing tests')
    expect(result).toContain('WHERE: src/auth.ts')
    expect(result).toContain('FIX: Add unit tests')
    expect(result).toContain('WHAT: Bad naming')
  })
})
