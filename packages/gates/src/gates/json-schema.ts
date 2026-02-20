import { z } from 'zod'
import type { GateResult, JsonSchemaGate, SimpleJsonSchema } from '../types.js'

interface ValidationFailure {
  path: string
  message: string
}

function formatPath(path: string[]): string {
  return path.length === 0 ? '$' : path.join('.')
}

function typeOfValue(value: unknown): SimpleJsonSchema['type'] {
  if (value === null) return 'null'
  if (Array.isArray(value)) return 'array'
  if (typeof value === 'string') return 'string'
  if (typeof value === 'number') return 'number'
  if (typeof value === 'boolean') return 'boolean'
  if (typeof value === 'object') return 'object'
  return undefined
}

function validateSimpleSchema(value: unknown, schema: SimpleJsonSchema, path: string[] = []): ValidationFailure[] {
  const failures: ValidationFailure[] = []
  const effectiveType = schema.type ?? (schema.required ? 'object' : undefined)

  if (effectiveType) {
    const actualType = typeOfValue(value)
    if (actualType !== effectiveType) {
      failures.push({
        path: formatPath(path),
        message: `Expected ${effectiveType}, received ${actualType ?? 'unknown'}`
      })
      return failures
    }
  }

  if ((effectiveType === 'object' || (!effectiveType && schema.required)) && value && typeof value === 'object' && !Array.isArray(value)) {
    const asRecord = value as Record<string, unknown>

    for (const requiredKey of schema.required ?? []) {
      if (!(requiredKey in asRecord)) {
        failures.push({
          path: formatPath([...path, requiredKey]),
          message: 'Required field missing'
        })
      }
    }

    for (const [prop, childSchema] of Object.entries(schema.properties ?? {})) {
      if (!(prop in asRecord)) continue
      failures.push(...validateSimpleSchema(asRecord[prop], childSchema, [...path, prop]))
    }
  }

  if (effectiveType === 'array' && Array.isArray(value) && schema.items) {
    value.forEach((item, index) => {
      failures.push(...validateSimpleSchema(item, schema.items as SimpleJsonSchema, [...path, String(index)]))
    })
  }

  return failures
}

export function evaluateJsonSchemaGate(gate: JsonSchemaGate, input: unknown): GateResult {
  const started = Date.now()

  if ('safeParse' in gate.schema && typeof gate.schema.safeParse === 'function') {
    const zodSchema = gate.schema as z.ZodTypeAny
    const parsed = zodSchema.safeParse(input)

    if (parsed.success) {
      return {
        gate: gate.name ?? gate.type,
        passed: true,
        duration_ms: Date.now() - started
      }
    }

    return {
      gate: gate.name ?? gate.type,
      passed: false,
      reason: `Zod schema validation failed at ${parsed.error.issues[0]?.path.join('.') || '$'}`,
      details: parsed.error.issues.map((issue) => ({
        path: issue.path.join('.') || '$',
        message: issue.message
      })),
      duration_ms: Date.now() - started
    }
  }

  const simpleSchema = gate.schema as SimpleJsonSchema
  const failures = validateSimpleSchema(input, simpleSchema)

  if (failures.length === 0) {
    return {
      gate: gate.name ?? gate.type,
      passed: true,
      duration_ms: Date.now() - started
    }
  }

  return {
    gate: gate.name ?? gate.type,
    passed: false,
    reason: `${failures[0].message} at ${failures[0].path}`,
    details: failures,
    duration_ms: Date.now() - started
  }
}
