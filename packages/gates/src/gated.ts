import type {
  GatedOptions,
  GatedResult,
  RetryContext,
} from './types.js'
import { retry } from './retry.js'
import { parseOutput } from './utils/parse-output.js'

function extractData<T>(raw: unknown, mode: GatedOptions<T>['extract']): T {
  if (typeof mode === 'function') {
    return mode(raw)
  }

  switch (mode) {
    case 'text':
      return (typeof raw === 'string' ? raw : String(raw)) as T

    case 'json': {
      if (typeof raw === 'string') {
        const parsed = parseOutput(raw)
        if (parsed !== null) return parsed as T
      }
      return raw as T
    }

    case 'auto':
    default: {
      if (typeof raw === 'string') {
        const parsed = parseOutput(raw)
        if (parsed !== null) return parsed as T
        return raw as T
      }
      return raw as T
    }
  }
}

export async function gated<T = unknown>(
  producer: (context?: RetryContext) => Promise<unknown>,
  options: GatedOptions<T>,
): Promise<GatedResult<T>> {
  return retry<T>(producer, options.gates, {
    ...options.retry,
    extract: (raw) => extractData<T>(raw, options.extract),
    onAttempt: options.onAttempt,
  })
}
