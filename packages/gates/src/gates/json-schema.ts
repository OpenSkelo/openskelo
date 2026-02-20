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

function validateSimpleSchema(
  value: unknown,
  schema: SimpleJsonSchema,
  path: string[] = [],
): ValidationFailure[] {
  const failures: ValidationFailure[] = []

  // Infer type from schema shape when not explicit
  const effectiveType = schema.type
    ?? (schema.required || schema.properties ? 'object' : undefined)

  // Type check
  if (effectiveType) {
    const actualType = typeOfValue(value)
    if (actualType !== effectiveType) {
      failures.push({
        path: formatPath(path),
        message: `Expected ${effectiveType}, received ${actualType ?? 'unknown'}`,
      })
      return failures
    }
  }

  // Object validation: required fields + nested properties
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const asRecord = value as Record<string, unknown>

    for (const requiredKey of schema.required ?? []) {
      if (!(requiredKey in asRecord) || asRecord[requiredKey] === undefined) {
        failures.push({
          path: formatPath([...path, requiredKey]),
          message: 'Required field missing',
        })
      }
    }

    for (const [prop, childSchema] of Object.entries(schema.properties ?? {})) {
      if (!(prop in asRecord)) continue
      failures.push(
        ...validateSimpleSchema(asRecord[prop], childSchema, [...path, prop]),
      )
    }
  }

  // Array validation: items schema
  if (Array.isArray(value) && schema.items) {
    value.forEach((item, index) => {
      failures.push(
        ...validateSimpleSchema(item, schema.items!, [...path, String(index)]),
      )
    })
  }

  return failures
}

function isZodSchema(schema: any): boolean {
  return schema && typeof schema === 'object' && typeof schema.safeParse === 'function'
}

export async function jsonSchemaGate(
  data: unknown,
  config: JsonSchemaGate,
): Promise<GateResult> {
  const gate = config.name ?? 'json_schema'
  const start = performance.now()

  // Zod schema mode — duck-type check for safeParse
  if (isZodSchema(config.schema)) {
    const result = (config.schema as any).safeParse(data)
    const duration_ms = performance.now() - start

    if (result.success) {
      return { gate, passed: true, duration_ms }
    }

    const issues = result.error.issues
    const reason = issues
      .map((i: any) => `${i.path.join('.') || '$'}: ${i.message}`)
      .join('; ')

    return {
      gate,
      passed: false,
      reason: `Schema validation failed: ${reason}`,
      details: issues,
      duration_ms,
    }
  }

  // Simple schema mode — recursive validation
  const simpleSchema = config.schema as SimpleJsonSchema
  const failures = validateSimpleSchema(data, simpleSchema)
  const duration_ms = performance.now() - start

  if (failures.length === 0) {
    return { gate, passed: true, duration_ms }
  }

  const reason = failures
    .map((f) => `${f.message} at ${f.path}`)
    .join('; ')

  return {
    gate,
    passed: false,
    reason,
    details: failures,
    duration_ms,
  }
}
