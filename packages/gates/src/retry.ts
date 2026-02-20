import { GateExhaustionError } from './errors.js'
import type {
  AttemptRecord,
  GateResult,
  RetryConfig,
  RetryContext
} from './types.js'

export interface RetryEngineOptions<T> {
  producer: (context: RetryContext) => Promise<{ data: T; raw: string }>
  evaluate: (data: T, raw: string, context: RetryContext) => Promise<GateResult[]>
  retry: RetryConfig
  onAttempt?: (record: AttemptRecord) => void | Promise<void>
}

export interface RetryEngineResult<T> {
  data: T
  raw: string
  gates: GateResult[]
  history: AttemptRecord[]
  attempts: number
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export function compileFeedback(failures: GateResult[]): string {
  if (failures.length === 0) return 'No gate failures recorded.'

  return failures
    .map((failure, index) => {
      const details = typeof failure.details === 'undefined' ? '' : `\n   details: ${JSON.stringify(failure.details)}`
      return `${index + 1}. [${failure.gate}] ${failure.reason ?? 'Gate failed'}${details}`
    })
    .join('\n')
}

function delayForAttempt(retry: RetryConfig, attempt: number): number {
  const base = retry.delay_ms ?? 0
  const backoff = retry.backoff ?? 'none'

  if (backoff === 'linear') return base * attempt
  if (backoff === 'exponential') return base * (2 ** (attempt - 1))
  return base
}

export async function runWithRetries<T>(options: RetryEngineOptions<T>): Promise<RetryEngineResult<T>> {
  const history: AttemptRecord[] = []
  const maxAttempts = Math.max(1, options.retry.max)

  let feedback: string | undefined
  let previousFailures: GateResult[] = []

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const started = Date.now()

    const context: RetryContext = {
      attempt,
      feedback,
      failures: previousFailures
    }

    const produced = await options.producer(context)
    const gates = await options.evaluate(produced.data, produced.raw, context)
    const passed = gates.every((gate) => gate.passed)

    const attemptRecord: AttemptRecord = {
      attempt,
      gates,
      passed,
      feedback_sent: feedback,
      duration_ms: Date.now() - started
    }

    history.push(attemptRecord)
    await options.onAttempt?.(attemptRecord)

    if (passed) {
      return {
        data: produced.data,
        raw: produced.raw,
        gates,
        history,
        attempts: attempt
      }
    }

    previousFailures = gates.filter((gate) => !gate.passed)

    if (attempt >= maxAttempts) {
      throw new GateExhaustionError('Gate checks exhausted retry limit', history)
    }

    feedback = options.retry.feedback ? compileFeedback(previousFailures) : undefined

    const waitMs = delayForAttempt(options.retry, attempt)
    if (waitMs > 0) {
      await sleep(waitMs)
    }
  }

  throw new GateExhaustionError('Gate checks exhausted retry limit', history)
}
