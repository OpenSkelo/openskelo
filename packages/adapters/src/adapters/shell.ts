import { BaseCliAdapter } from '../base-cli-adapter.js'
import type { TaskInput, AdapterResult } from '../types.js'
import type { RetryContext } from '@openskelo/gates'

export class ShellAdapter extends BaseCliAdapter {
  constructor() {
    super('shell', ['script', 'build', 'deploy', 'shell'], {
      command: 'sh',
      args: [],
    })
  }

  buildPrompt(task: TaskInput): string {
    return task.prompt
  }

  parseOutput(
    stdout: string,
    stderr: string,
    exitCode: number,
    _task: TaskInput,
  ): AdapterResult {
    const output = exitCode !== 0 && stderr
      ? `${stdout}${stderr}`
      : stdout

    return {
      output,
      structured: null,
      exit_code: exitCode,
      duration_ms: 0, // set by BaseCliAdapter
    }
  }

  async execute(task: TaskInput, retryCtx?: RetryContext): Promise<AdapterResult> {
    // Inject the prompt as the shell command: sh -c "<prompt>"
    const prompt = this.buildPrompt(task)
    const augmented: TaskInput = {
      ...task,
      backend_config: {
        ...task.backend_config,
        command: task.backend_config?.command ?? this.defaultConfig.command,
        args: ['-c', prompt],
      },
    }
    return super.execute(augmented, retryCtx)
  }
}
