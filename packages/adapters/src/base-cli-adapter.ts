import { spawn, type ChildProcess } from 'node:child_process'
import type {
  ExecutionAdapter,
  AdapterResult,
  AdapterConfig,
  TaskInput,
} from './types.js'
import type { RetryContext } from '@openskelo/gates'

export abstract class BaseCliAdapter implements ExecutionAdapter {
  readonly name: string
  readonly taskTypes: string[]
  protected defaultConfig: AdapterConfig

  private runningProcesses = new Map<string, ChildProcess>()

  constructor(name: string, taskTypes: string[], defaultConfig?: AdapterConfig) {
    this.name = name
    this.taskTypes = taskTypes
    this.defaultConfig = defaultConfig ?? {}
  }

  abstract buildPrompt(task: TaskInput): string
  abstract parseOutput(
    stdout: string,
    stderr: string,
    exitCode: number,
    task: TaskInput,
  ): AdapterResult

  canHandle(task: TaskInput): boolean {
    return task.backend === this.name || this.taskTypes.includes(task.type)
  }

  async execute(task: TaskInput, _retryCtx?: RetryContext): Promise<AdapterResult> {
    const config = this.mergeConfig(task.backend_config)
    const prompt = this.buildPrompt(task)

    if (!config.command) {
      return {
        output: '',
        exit_code: 1,
        duration_ms: 0,
        structured: null,
      }
    }

    const start = performance.now()

    try {
      const { stdout, stderr, exitCode } = await this.spawnProcess(
        task.id,
        config.command,
        config.args ?? [],
        config.cwd,
        config.env,
        config.timeout_ms,
        this.shouldPipePromptToStdin(task) ? prompt : undefined,
      )

      const result = this.parseOutput(stdout, stderr, exitCode, task)
      result.duration_ms = performance.now() - start
      return result
    } catch {
      return {
        output: '',
        exit_code: 1,
        duration_ms: performance.now() - start,
        structured: null,
      }
    }
  }

  async abort(taskId: string): Promise<void> {
    const proc = this.runningProcesses.get(taskId)
    if (!proc) return

    proc.kill('SIGTERM')

    // Force kill after 5 seconds if still alive
    const forceKill = setTimeout(() => {
      if (!proc.killed) proc.kill('SIGKILL')
    }, 5000)

    await new Promise<void>(resolve => {
      proc.on('exit', () => {
        clearTimeout(forceKill)
        resolve()
      })
      // If already dead, resolve immediately
      if (proc.exitCode !== null || proc.signalCode !== null) {
        clearTimeout(forceKill)
        resolve()
      }
    })

    this.runningProcesses.delete(taskId)
  }

  private mergeConfig(taskConfig?: AdapterConfig): AdapterConfig {
    if (!taskConfig) return { ...this.defaultConfig }
    return {
      command: taskConfig.command ?? this.defaultConfig.command,
      args: taskConfig.args ?? this.defaultConfig.args,
      cwd: taskConfig.cwd ?? this.defaultConfig.cwd,
      env: { ...this.defaultConfig.env, ...taskConfig.env },
      model: taskConfig.model ?? this.defaultConfig.model,
      provider: taskConfig.provider ?? this.defaultConfig.provider,
      timeout_ms: taskConfig.timeout_ms ?? this.defaultConfig.timeout_ms,
    }
  }

  protected shouldPipePromptToStdin(_task: TaskInput): boolean {
    return true
  }

  private spawnProcess(
    taskId: string,
    command: string,
    args: string[],
    cwd?: string,
    env?: Record<string, string>,
    timeoutMs?: number,
    stdinInput?: string,
  ): Promise<{ stdout: string; stderr: string; exitCode: number }> {
    return new Promise((resolve, reject) => {
      let proc: ChildProcess

      try {
        proc = spawn(command, args, {
          cwd,
          env: env ? { ...process.env, ...env } : process.env,
          stdio: ['pipe', 'pipe', 'pipe'],
        })
      } catch (err) {
        reject(err)
        return
      }

      this.runningProcesses.set(taskId, proc)

      let stdout = ''
      let stderr = ''
      let timeoutId: ReturnType<typeof setTimeout> | undefined
      let timedOut = false

      proc.stdin?.on('error', (err: NodeJS.ErrnoException) => {
        if (err.code === 'EPIPE') return
        if (timeoutId) clearTimeout(timeoutId)
        this.runningProcesses.delete(taskId)
        reject(err)
      })

      if (stdinInput !== undefined) {
        proc.stdin?.write(stdinInput)
      }
      proc.stdin?.end()

      proc.stdout?.on('data', (chunk: Buffer) => {
        stdout += chunk.toString()
      })

      proc.stderr?.on('data', (chunk: Buffer) => {
        stderr += chunk.toString()
      })

      if (timeoutMs) {
        timeoutId = setTimeout(() => {
          timedOut = true
          stderr += `${stderr && !stderr.endsWith('\n') ? '\n' : ''}Process timed out`

          proc.kill('SIGTERM')
          setTimeout(() => {
            if (!proc.killed) proc.kill('SIGKILL')
          }, 1000)
        }, timeoutMs)
      }

      proc.on('error', (err) => {
        if (timeoutId) clearTimeout(timeoutId)
        this.runningProcesses.delete(taskId)
        reject(err)
      })

      proc.on('close', (code, signal) => {
        if (timeoutId) clearTimeout(timeoutId)
        this.runningProcesses.delete(taskId)
        const exitCode = timedOut ? 124 : (code ?? (signal ? 1 : 0))
        resolve({ stdout, stderr, exitCode })
      })
    })
  }
}
