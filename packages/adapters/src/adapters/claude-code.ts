import { BaseCliAdapter } from '../base-cli-adapter.js'
import { buildTaskPrompt } from '../utils/prompt-builder.js'
import type { TaskInput, AdapterResult } from '../types.js'

export class ClaudeCodeAdapter extends BaseCliAdapter {
  constructor() {
    super('claude-code', ['code', 'refactor', 'test', 'review', 'general'], {
      command: 'claude',
      args: ['--print'],
    })
  }

  buildPrompt(task: TaskInput): string {
    return buildTaskPrompt(task)
  }

  parseOutput(
    stdout: string,
    _stderr: string,
    exitCode: number,
    _task: TaskInput,
  ): AdapterResult {
    let structured: unknown = null
    try {
      structured = JSON.parse(stdout)
    } catch {
      // not JSON, that's fine
    }

    const filesChanged = detectFilesChanged(stdout)

    return {
      output: stdout,
      structured,
      files_changed: filesChanged.length ? filesChanged : undefined,
      exit_code: exitCode,
      duration_ms: 0, // set by BaseCliAdapter
    }
  }
}

function detectFilesChanged(stdout: string): string[] {
  const patterns = [
    /Created file:\s*(.+)/g,
    /Modified:\s*(.+)/g,
    /Wrote\s+(.+)/g,
    /Updated\s+(.+)/g,
  ]

  const files = new Set<string>()
  for (const pattern of patterns) {
    let match
    while ((match = pattern.exec(stdout)) !== null) {
      files.add(match[1].trim())
    }
  }
  return [...files]
}
