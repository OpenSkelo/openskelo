import { mkdtempSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { describe, expect, it } from 'vitest'
import { evaluateCommandGate } from '../src/gates/command.js'

describe('command gate', () => {
  it('passes on exit code 0', () => {
    const result = evaluateCommandGate({ type: 'command', run: 'node -e "process.exit(0)"' })
    expect(result.passed).toBe(true)
  })

  it('fails on exit code 1', () => {
    const result = evaluateCommandGate({ type: 'command', run: 'node -e "process.exit(1)"' })
    expect(result.passed).toBe(false)
  })

  it('passes with custom expected exit code', () => {
    const result = evaluateCommandGate({ type: 'command', run: 'node -e "process.exit(5)"', expect_exit: 5 })
    expect(result.passed).toBe(true)
  })

  it('fails when expected exit code mismatches', () => {
    const result = evaluateCommandGate({ type: 'command', run: 'node -e "process.exit(5)"', expect_exit: 0 })
    expect(result.passed).toBe(false)
  })

  it('fails gracefully on timeout', () => {
    const result = evaluateCommandGate({ type: 'command', run: 'node -e "setTimeout(()=>{}, 2000)"', timeout_ms: 100 })
    expect(result.passed).toBe(false)
    expect(result.reason).toBeTruthy()
  })

  it('captures stderr in details', () => {
    const result = evaluateCommandGate({ type: 'command', run: 'node -e "console.error(\"boom\"); process.exit(1)"' })
    expect(result.passed).toBe(false)
    expect(String((result.details as { stderr?: string }).stderr)).toContain('boom')
  })

  it('supports custom cwd', () => {
    const cwd = mkdtempSync(join(tmpdir(), 'gate-cwd-'))
    const result = evaluateCommandGate({ type: 'command', run: 'node -e "console.log(process.cwd())"', cwd })
    expect(result.passed).toBe(true)
    expect(String((result.details as { stdout?: string }).stdout).trim()).toContain(cwd)
  })

  it('supports custom env vars', () => {
    const result = evaluateCommandGate({
      type: 'command',
      run: 'node -e "console.log(process.env.GATE_TEST_VAR)"',
      env: { GATE_TEST_VAR: 'hello' }
    })
    expect(result.passed).toBe(true)
    expect(String((result.details as { stdout?: string }).stdout).trim()).toBe('hello')
  })

  it('fails gracefully for nonexistent command', () => {
    const result = evaluateCommandGate({ type: 'command', run: 'this_command_should_not_exist_12345' })
    expect(result.passed).toBe(false)
  })

  it('uses custom gate name', () => {
    const result = evaluateCommandGate({ type: 'command', name: 'shell-check', run: 'node -e "process.exit(0)"' })
    expect(result.gate).toBe('shell-check')
  })

  it('records duration', () => {
    const result = evaluateCommandGate({ type: 'command', run: 'node -e "process.exit(0)"' })
    expect(result.duration_ms).toBeGreaterThanOrEqual(0)
  })

  it('keeps stdout in details', () => {
    const result = evaluateCommandGate({ type: 'command', run: 'node -e "process.stdout.write(\'ok\')"' })
    expect(String((result.details as { stdout?: string }).stdout)).toContain('ok')
  })

  it('supports shell scripts in cwd', () => {
    const cwd = mkdtempSync(join(tmpdir(), 'gate-script-'))
    const scriptPath = join(cwd, 'script.js')
    writeFileSync(scriptPath, 'process.exit(0)')
    const result = evaluateCommandGate({ type: 'command', run: 'node script.js', cwd })
    expect(result.passed).toBe(true)
  })

  it('returns exit code in details', () => {
    const result = evaluateCommandGate({ type: 'command', run: 'node -e "process.exit(3)"' })
    expect((result.details as { exit_code?: number }).exit_code).toBe(3)
  })

  it('handles empty stderr safely', () => {
    const result = evaluateCommandGate({ type: 'command', run: 'node -e "process.exit(0)"' })
    expect(result.passed).toBe(true)
    expect(typeof (result.details as { stderr?: string }).stderr).toBe('string')
  })
})
