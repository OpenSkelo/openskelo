import { describe, it, expect } from 'vitest'
import { commandGate } from '../src/gates/command.js'
import path from 'node:path'

describe('command gate', () => {
  // ── Exit code checks ──

  describe('exit code', () => {
    it('passes when command exits with 0 (default)', async () => {
      const result = await commandGate(
        { some: 'data' },
        { type: 'command', run: 'echo hello' },
      )
      expect(result.passed).toBe(true)
      expect(result.gate).toBe('command')
    })

    it('fails when command exits with non-zero', async () => {
      const result = await commandGate(
        { some: 'data' },
        { type: 'command', run: 'exit 1' },
      )
      expect(result.passed).toBe(false)
      expect(result.reason).toMatch(/exit/i)
    })

    it('passes when exit code matches expect_exit', async () => {
      const result = await commandGate(
        {},
        { type: 'command', run: 'exit 42', expect_exit: 42 },
      )
      expect(result.passed).toBe(true)
    })

    it('fails when exit code does not match expect_exit', async () => {
      const result = await commandGate(
        {},
        { type: 'command', run: 'exit 1', expect_exit: 0 },
      )
      expect(result.passed).toBe(false)
      expect(result.details?.exit_code).toBe(1)
    })

    it('captures stdout', async () => {
      const result = await commandGate(
        {},
        { type: 'command', run: 'echo "test output"' },
      )
      expect(result.passed).toBe(true)
      expect(result.details?.stdout).toContain('test output')
    })

    it('captures stderr on failure', async () => {
      const result = await commandGate(
        {},
        { type: 'command', run: 'echo "error msg" >&2 && exit 1' },
      )
      expect(result.passed).toBe(false)
      expect(result.details?.stderr).toContain('error msg')
    })
  })

  // ── Timeout ──

  describe('timeout', () => {
    it('fails when command times out', async () => {
      const result = await commandGate(
        {},
        { type: 'command', run: 'sleep 10', timeout_ms: 100 },
      )
      expect(result.passed).toBe(false)
      expect(result.reason).toMatch(/timeout|timed out/i)
    }, 5000)
  })

  // ── Working directory ──

  describe('cwd', () => {
    it('runs command in specified directory', async () => {
      const result = await commandGate(
        {},
        { type: 'command', run: 'pwd', cwd: '/tmp' },
      )
      expect(result.passed).toBe(true)
      // /tmp might resolve to /private/tmp on macOS
      expect(result.details?.stdout?.trim()).toMatch(/\/tmp/)
    })
  })

  // ── Environment variables ──

  describe('env', () => {
    it('passes env vars to command', async () => {
      const result = await commandGate(
        {},
        { type: 'command', run: 'echo $MY_TEST_VAR', env: { MY_TEST_VAR: 'hello123' } },
      )
      expect(result.passed).toBe(true)
      expect(result.details?.stdout).toContain('hello123')
    })
  })

  // ── Data piping ──

  describe('data piping', () => {
    it('makes data available as GATE_DATA env var', async () => {
      const result = await commandGate(
        { price: 42 },
        { type: 'command', run: 'echo "$GATE_DATA"' },
      )
      expect(result.passed).toBe(true)
      const parsed = JSON.parse(result.details?.stdout?.trim())
      expect(parsed.price).toBe(42)
    })
  })

  // ── Metadata ──

  describe('metadata', () => {
    it('uses custom name', async () => {
      const result = await commandGate(
        {},
        { type: 'command', run: 'echo ok', name: 'npm test' },
      )
      expect(result.gate).toBe('npm test')
    })

    it('tracks duration_ms', async () => {
      const result = await commandGate(
        {},
        { type: 'command', run: 'echo ok' },
      )
      expect(typeof result.duration_ms).toBe('number')
      expect(result.duration_ms).toBeGreaterThanOrEqual(0)
    })

    it('handles command not found', async () => {
      const result = await commandGate(
        {},
        { type: 'command', run: 'nonexistent_command_xyz_123' },
      )
      expect(result.passed).toBe(false)
    })
  })
})
