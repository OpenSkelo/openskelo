import { BaseCliAdapter } from '../base-cli-adapter.js'
import { buildTaskPrompt } from '../utils/prompt-builder.js'
import type { TaskInput, AdapterResult } from '../types.js'
import type { RetryContext } from '@openskelo/gates'

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

  protected shouldPipePromptToStdin(): boolean {
    return false
  }

  async execute(task: TaskInput, retryCtx?: RetryContext): Promise<AdapterResult> {
    const prompt = this.buildPrompt(task)
    const baseArgs = task.backend_config?.args ?? this.defaultConfig.args ?? []

    const augmented: TaskInput = {
      ...task,
      backend_config: {
        ...task.backend_config,
        command: task.backend_config?.command ?? this.defaultConfig.command,
        args: [...baseArgs, prompt],
      },
    }

    return super.execute(augmented, retryCtx)
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
