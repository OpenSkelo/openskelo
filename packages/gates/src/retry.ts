import type {
  GateDefinition,
  GateResult,
  GatedResult,
  RetryConfig,
  RetryContext,
  AttemptRecord,
} from './types.js'
import { GateExhaustionError } from './types.js'
import { createGateRunner } from './runner.js'

const DEFAULT_RETRY: RetryConfig = {
  max: 3,
  feedback: true,
}

export function compileFeedback(
  failures: GateResult[],
  attempt: number,
  maxAttempts: number,
): string {
  if (failures.length === 0) return ''

  const lines = failures.map((f, i) => {
    let msg = `${i + 1}. [${f.gate}] ${f.reason ?? 'Failed'}`
    if (f.details) {
      const detailStr = typeof f.details === 'string'
        ? f.details
        : JSON.stringify(f.details)
      msg += `\n   Details: ${detailStr}`
    }
    return msg
  })

  return [
    'Your previous output failed verification.',
    '',
    `Attempt ${attempt} of ${maxAttempts}. Failures:`,
    '',
    ...lines,
    '',
    'Please fix these issues and try again. Keep all other content that was correct.',
  ].join('\n')
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export async function retry<T = unknown>(
  producer: (context?: RetryContext) => Promise<T>,
  gates: GateDefinition[],
  config?: Partial<RetryConfig>,
): Promise<GatedResult<T>> {
  const opts = { ...DEFAULT_RETRY, ...config }
  const runner = createGateRunner(gates)
  const history: AttemptRecord[] = []
  const totalStart = performance.now()
  let lastFailures: GateResult[] = []

  for (let attempt = 1; attempt <= opts.max; attempt++) {
    const attemptStart = performance.now()

    // Build context for retry
    let context: RetryContext | undefined
    if (attempt > 1) {
      context = {
        attempt,
        feedback: opts.feedback ? compileFeedback(lastFailures, attempt, opts.max) : '',
        failures: lastFailures,
      }
    }

    // Call producer
    const raw = await producer(context)
    const data = raw as T

    // Evaluate gates
    const gateResults = await runner.evaluate(data, raw)
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

    // Delay before next attempt (if not last attempt)
    if (attempt < opts.max && opts.delay_ms && opts.delay_ms > 0) {
      const delay = opts.backoff
        ? opts.delay_ms * Math.pow(2, attempt - 1)
        : opts.delay_ms
      await sleep(delay)
    }
  }

  throw new GateExhaustionError(history, lastFailures)
}
