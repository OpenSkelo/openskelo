import { execSync } from 'node:child_process'
import type { GateResult, CommandGate } from '../types.js'

export async function commandGate(
  data: unknown,
  config: CommandGate,
): Promise<GateResult> {
  const gate = config.name ?? 'command'
  const start = performance.now()
  const expectExit = config.expect_exit ?? 0
  const timeoutMs = config.timeout_ms ?? 60000

  const env = {
    ...process.env,
    ...config.env,
    GATE_DATA: JSON.stringify(data),
  }

  try {
    const stdout = execSync(config.run, {
      cwd: config.cwd,
      env,
      timeout: timeoutMs,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
      shell: '/bin/sh',
    })

    const duration_ms = performance.now() - start

    if (expectExit === 0) {
      return {
        gate,
        passed: true,
        details: { exit_code: 0, stdout, stderr: '' },
        duration_ms,
      }
    }

    return {
      gate,
      passed: false,
      reason: `Expected exit code ${expectExit}, got 0`,
      details: { exit_code: 0, stdout, stderr: '' },
      duration_ms,
    }
  } catch (err: any) {
    const duration_ms = performance.now() - start

    // Timeout case
    if (err.killed || err.signal === 'SIGTERM') {
      return {
        gate,
        passed: false,
        reason: `Command timed out after ${timeoutMs}ms`,
        details: {
          exit_code: null,
          stdout: err.stdout ?? '',
          stderr: err.stderr ?? '',
          timeout: true,
        },
        duration_ms,
      }
    }

    const exitCode = err.status ?? err.code ?? 1
    const stdout = err.stdout ?? ''
    const stderr = err.stderr ?? ''

    if (exitCode === expectExit) {
      return {
        gate,
        passed: true,
        details: { exit_code: exitCode, stdout, stderr },
        duration_ms,
      }
    }

    return {
      gate,
      passed: false,
      reason: `Command exited with code ${exitCode} (expected ${expectExit})`,
      details: { exit_code: exitCode, stdout, stderr },
      duration_ms,
    }
  }
}
