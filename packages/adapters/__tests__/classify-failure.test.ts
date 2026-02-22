import { describe, it, expect } from 'vitest'
import { classifyFailure, classifyHttpStatus } from '../src/utils/classify-failure.js'

describe('classifyFailure', () => {
  it('returns undefined for exit_code 0', () => {
    expect(classifyFailure(0, 'everything is fine')).toBeUndefined()
  })

  it('returns timeout for exit_code 124', () => {
    expect(classifyFailure(124, '')).toBe('timeout')
  })

  it('detects permission_required from output', () => {
    expect(classifyFailure(1, 'Error: not allowed to write files')).toBe('permission_required')
    expect(classifyFailure(1, 'EPERM: operation not permitted')).toBe('permission_required')
    expect(classifyFailure(1, 'Use --dangerously-skip-permissions to bypass')).toBe('permission_required')
  })

  it('detects rate_limited from output', () => {
    expect(classifyFailure(1, 'Error: rate limit exceeded')).toBe('rate_limited')
    expect(classifyFailure(1, 'HTTP 429 Too Many Requests')).toBe('rate_limited')
    expect(classifyFailure(1, 'Request was throttled')).toBe('rate_limited')
  })

  it('detects timeout from output', () => {
    expect(classifyFailure(1, 'Process timed out')).toBe('timeout')
    expect(classifyFailure(1, 'ETIMEDOUT: connection timed out')).toBe('timeout')
    expect(classifyFailure(1, 'deadline exceeded')).toBe('timeout')
  })

  it('detects tool_unavailable from output', () => {
    expect(classifyFailure(1, 'command not found: claude')).toBe('tool_unavailable')
    expect(classifyFailure(127, 'sh: claude: not found')).toBe('tool_unavailable')
    expect(classifyFailure(1, 'ENOENT: no such file or directory')).toBe('tool_unavailable')
  })

  it('detects network_error from output', () => {
    expect(classifyFailure(1, 'ECONNREFUSED 127.0.0.1:3000')).toBe('network_error')
    expect(classifyFailure(1, 'TypeError: fetch failed')).toBe('network_error')
    expect(classifyFailure(1, 'ECONNRESET: connection reset by peer')).toBe('network_error')
  })

  it('returns unknown for unrecognized errors', () => {
    expect(classifyFailure(1, 'Something went wrong')).toBe('unknown')
    expect(classifyFailure(42, '')).toBe('unknown')
  })

  it('is case-insensitive', () => {
    expect(classifyFailure(1, 'RATE LIMIT EXCEEDED')).toBe('rate_limited')
    expect(classifyFailure(1, 'Permission Denied')).toBe('permission_required')
  })
})

describe('classifyHttpStatus', () => {
  it('maps 429 to rate_limited', () => {
    expect(classifyHttpStatus(429)).toBe('rate_limited')
  })

  it('maps 403 to permission_required', () => {
    expect(classifyHttpStatus(403)).toBe('permission_required')
  })

  it('maps 408 to timeout', () => {
    expect(classifyHttpStatus(408)).toBe('timeout')
  })

  it('maps 504 to timeout', () => {
    expect(classifyHttpStatus(504)).toBe('timeout')
  })

  it('maps 404 to tool_unavailable', () => {
    expect(classifyHttpStatus(404)).toBe('tool_unavailable')
  })

  it('maps 500 to unknown', () => {
    expect(classifyHttpStatus(500)).toBe('unknown')
  })
})
