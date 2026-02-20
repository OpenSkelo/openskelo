import { BaseCliAdapter } from '../base-cli-adapter.js'
import { buildTaskPrompt } from '../utils/prompt-builder.js'
import type { TaskInput, AdapterResult } from '../types.js'

export class CodexAdapter extends BaseCliAdapter {
  constructor() {
    super('codex', ['code', 'refactor', 'general'], {
      command: 'codex',
      args: [],
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
      // not JSON
    }

    return {
      output: stdout,
      structured,
      exit_code: exitCode,
      duration_ms: 0, // set by BaseCliAdapter
    }
  }
}
