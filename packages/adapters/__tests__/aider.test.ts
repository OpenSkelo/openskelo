import { describe, it, expect } from 'vitest'
import { AiderAdapter } from '../src/adapters/aider.js'
import type { TaskInput } from '../src/types.js'

function makeTask(overrides: Partial<TaskInput> = {}): TaskInput {
  return {
    id: 'aider-1',
    type: 'code',
    summary: 'Fix CSS layout',
    prompt: 'The sidebar overlaps the main content on mobile.',
    backend: 'aider',
    ...overrides,
  }
}

describe('AiderAdapter', () => {
  const adapter = new AiderAdapter()

  it('buildPrompt includes task summary and prompt', () => {
    const result = adapter.buildPrompt(makeTask())
    expect(result).toContain('Task: Fix CSS layout')
    expect(result).toContain('The sidebar overlaps')
  })

  it('buildPrompt formats for --message style', () => {
    const result = adapter.buildPrompt(makeTask())
    // Should be a single string suitable for --message flag
    expect(typeof result).toBe('string')
    expect(result.length).toBeGreaterThan(0)
  })

  it('parseOutput captures stdout', () => {
    const result = adapter.parseOutput('aider output', '', 0, makeTask())
    expect(result.output).toBe('aider output')
    expect(result.exit_code).toBe(0)
  })

  it('canHandle returns true for backend aider', () => {
    expect(adapter.canHandle(makeTask())).toBe(true)
  })

  it('default args include --message', () => {
    expect(adapter.name).toBe('aider')
  })
})
