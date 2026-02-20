import { GateExhaustionError, GateFailureError } from './errors.js'
import { createGateRunner } from './runner.js'
import { runWithRetries } from './retry.js'
import { parseOutput } from './utils/parse-output.js'
import type {
  AttemptRecord,
  GateDefinition,
  GatedOptions,
  GatedResult,
  RetryContext
} from './types.js'

async function withTimeout<T>(promise: Promise<T>, timeoutMs?: number): Promise<T> {
  if (!timeoutMs || timeoutMs <= 0) return promise

  return await Promise.race([
    promise,
    new Promise<T>((_, reject) => {
      setTimeout(() => reject(new Error(`Attempt timed out after ${timeoutMs}ms`)), timeoutMs)
    })
  ])
}

async function extractData<T>(raw: string, extract: GatedOptions<T>['extract']): Promise<T> {
  if (typeof extract === 'function') {
    return await extract(raw)
  }

  if (extract === 'text') {
    return raw as T
  }

  if (extract === 'json') {
    return parseOutput(raw) as T
  }

  try {
    return parseOutput(raw) as T
  } catch {
    return raw as T
  }
}

function outputToRaw(output: unknown): string {
  if (typeof output === 'string') return output
  if (typeof output === 'object' && output !== null && 'raw' in output) {
    const raw = (output as { raw?: unknown }).raw
    if (typeof raw === 'string') return raw
  }

  if (typeof output === 'object') return JSON.stringify(output)
  return String(output)
}

export async function gated<T>(
  producer: (context: RetryContext) => Promise<unknown> | unknown,
  options: GatedOptions<T>
): Promise<GatedResult<T>> {
  const started = Date.now()
  const retry = options.retry ?? { max: 1, feedback: true, delay_ms: 0, backoff: 'none' }
  const extract = options.extract ?? 'auto'

  const gateRunner = createGateRunner(options.gates)

  const result = await runWithRetries<T>({
    retry,
    onAttempt: options.onAttempt,
    producer: async (context) => {
      const output = await withTimeout(Promise.resolve(producer(context)), options.timeout)
      const raw = outputToRaw(output)
      const data = await extractData<T>(raw, extract)
      return { data, raw }
    },
    evaluate: async (data, raw) => {
      const gates = await gateRunner.evaluate(data, raw)
      const firstFailure = gates.find((gate) => !gate.passed)
      if (firstFailure) {
        void new GateFailureError('Gate failed', firstFailure)
      }
      return gates
    }
  })

  return {
    data: result.data,
    raw: result.raw,
    attempts: result.attempts,
    gates: result.gates,
    history: result.history,
    duration_ms: Date.now() - started
  }
}

export { createGateRunner, GateExhaustionError, GateFailureError }

export type {
  AttemptRecord,
  CommandGate,
  CustomGate,
  Extractor,
  GateDefinition,
  GateEvaluationContext,
  GateResult,
  GateRunnerOptions,
  GatedOptions,
  GatedResult,
  JsonSchemaGate,
  LlmProvider,
  LlmReviewGate,
  LlmReviewInput,
  LlmReviewOutput,
  RegexGate,
  RetryConfig,
  RetryContext,
  SimpleJsonSchema,
  WordCountGate
} from './types.js'
