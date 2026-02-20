import type {
  GatedOptions,
  GatedResult,
  RetryContext,
  AttemptRecord,
  GateResult,
} from './types.js'
import { GateExhaustionError } from './types.js'
import { createGateRunner } from './runner.js'
import { compileFeedback } from './retry.js'
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

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export async function gated<T = unknown>(
  producer: (context?: RetryContext) => Promise<unknown>,
  options: GatedOptions<T>,
): Promise<GatedResult<T>> {
  const retryConfig = {
    max: options.retry?.max ?? 3,
    feedback: options.retry?.feedback ?? true,
    delay_ms: options.retry?.delay_ms,
    backoff: options.retry?.backoff,
  }

  const runner = createGateRunner(options.gates)
  const history: AttemptRecord[] = []
  const totalStart = performance.now()
  let lastFailures: GateResult[] = []

  for (let attempt = 1; attempt <= retryConfig.max; attempt++) {
    const attemptStart = performance.now()

    // Build retry context
    let context: RetryContext | undefined
    if (attempt > 1) {
      context = {
        attempt,
        feedback: retryConfig.feedback
          ? compileFeedback(lastFailures, attempt, retryConfig.max)
          : '',
        failures: lastFailures,
      }
    }

    // Call producer
    const raw = await producer(context)

    // Extract data
    const data = extractData<T>(raw, options.extract)

    // Convert raw to string for text-based gates
    const rawStr = typeof raw === 'string' ? raw : JSON.stringify(raw)

    // Evaluate gates
    const gateResults = await runner.evaluate(data, rawStr)
    const passed = gateResults.length === 0 || gateResults.every((g) => g.passed)
    const attemptDuration = performance.now() - attemptStart

    const record: AttemptRecord = {
      attempt,
      gates: gateResults,
      passed,
      duration_ms: attemptDuration,
    }

    if (attempt > 1 && context?.feedback) {
      record.feedback_sent = context.feedback
    }

    history.push(record)

    // Fire onAttempt callback
    if (options.onAttempt) {
      options.onAttempt({
        attempt,
        gates: gateResults,
        passed,
        duration_ms: attemptDuration,
      })
    }

    if (passed) {
      return {
        data,
        raw,
        attempts: attempt,
        gates: gateResults,
        history,
        duration_ms: performance.now() - totalStart,
      }
    }

    // Store failures for next retry
    lastFailures = gateResults.filter((g) => !g.passed)

    // Delay before next attempt
    if (attempt < retryConfig.max && retryConfig.delay_ms && retryConfig.delay_ms > 0) {
      const delay = retryConfig.backoff
        ? retryConfig.delay_ms * Math.pow(2, attempt - 1)
        : retryConfig.delay_ms
      await sleep(delay)
    }
  }

  throw new GateExhaustionError(history, lastFailures)
}
