import { spawnSync } from 'node:child_process'
import type { CommandGate, GateResult } from '../types.js'

export function evaluateCommandGate(gate: CommandGate): GateResult {
  const started = Date.now()
  const expected = typeof gate.expect_exit === 'number' ? gate.expect_exit : 0

  const result = spawnSync(gate.run, {
    shell: true,
    cwd: gate.cwd,
    env: {
      ...process.env,
      ...(gate.env ?? {})
    },
    timeout: gate.timeout_ms,
    encoding: 'utf8'
  })

  if (result.error) {
    return {
      gate: gate.name ?? gate.type,
      passed: false,
      reason: result.error.message,
      details: {
        exit_code: result.status,
        stderr: result.stderr?.toString() ?? ''
      },
      duration_ms: Date.now() - started
    }
  }

  const exitCode = result.status ?? 0
  const passed = exitCode === expected

  return {
    gate: gate.name ?? gate.type,
    passed,
    reason: passed ? undefined : `Expected exit code ${expected}, received ${exitCode}`,
    details: {
      exit_code: exitCode,
      stdout: result.stdout?.toString() ?? '',
      stderr: result.stderr?.toString() ?? ''
    },
    duration_ms: Date.now() - started
  }
}
