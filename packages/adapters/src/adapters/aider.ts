import { BaseCliAdapter } from '../base-cli-adapter.js'
import { buildTaskPrompt } from '../utils/prompt-builder.js'
import type { TaskInput, AdapterResult } from '../types.js'

export class AiderAdapter extends BaseCliAdapter {
  constructor() {
    super('aider', ['code', 'refactor'], {
      command: 'aider',
      args: ['--message'],
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
    const filesChanged = detectAiderFiles(stdout)

    return {
      output: stdout,
      structured: null,
      files_changed: filesChanged.length ? filesChanged : undefined,
      exit_code: exitCode,
      duration_ms: 0, // set by BaseCliAdapter
    }
  }
}

function detectAiderFiles(stdout: string): string[] {
  const patterns = [
    /Wrote\s+(.+)/g,
    /Applied edit to\s+(.+)/g,
    /Editing\s+(.+)/g,
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
