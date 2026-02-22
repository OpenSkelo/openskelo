import type { FailureCode } from '../types.js'

interface FailurePattern {
  hints: string[]
  code: FailureCode
}

const PATTERNS: FailurePattern[] = [
  {
    hints: ['permission', 'not allowed', 'EPERM', 'EACCES', 'dangerously-skip-permissions'],
    code: 'permission_required',
  },
  {
    hints: ['rate limit', 'rate_limit', '429', 'too many requests', 'throttled'],
    code: 'rate_limited',
  },
  {
    hints: ['timed out', 'timeout', 'ETIMEDOUT', 'ESOCKETTIMEDOUT', 'deadline exceeded'],
    code: 'timeout',
  },
  {
    hints: ['not found', 'ENOENT', 'command not found', 'tool unavailable', 'no such file'],
    code: 'tool_unavailable',
  },
  {
    hints: ['ECONNREFUSED', 'ECONNRESET', 'ENETUNREACH', 'network error', 'fetch failed'],
    code: 'network_error',
  },
]

/**
 * Classify an adapter failure by exit code and output text.
 * Returns undefined when exit_code === 0 (success).
 * Pure function — no side effects, no DB, no imports beyond types.
 */
export function classifyFailure(
  exitCode: number,
  output: string,
): FailureCode | undefined {
  if (exitCode === 0) return undefined

  // Exit code 124 is conventional for timeout (used by timeout(1) and BaseCliAdapter)
  if (exitCode === 124) return 'timeout'

  const lower = output.toLowerCase()

  for (const pattern of PATTERNS) {
    for (const hint of pattern.hints) {
      if (lower.includes(hint.toLowerCase())) {
        return pattern.code
      }
    }
  }

  return 'unknown'
}

/**
 * Map HTTP status codes to failure codes.
 * Used by BaseApiAdapter for non-ok responses.
 */
export function classifyHttpStatus(status: number): FailureCode {
  if (status === 429) return 'rate_limited'
  if (status === 403) return 'permission_required'
  if (status === 408 || status === 504) return 'timeout'
  if (status === 404) return 'tool_unavailable'
  return 'unknown'
}
