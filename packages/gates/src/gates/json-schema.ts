import type { GateResult, JsonSchemaGate } from '../types.js'

function isZodSchema(schema: any): boolean {
  return schema && typeof schema === 'object' && typeof schema.safeParse === 'function'
}

export async function jsonSchemaGate(
  data: unknown,
  config: JsonSchemaGate,
): Promise<GateResult> {
  const gate = config.name ?? 'json_schema'
  const start = performance.now()

  // Zod schema mode
  if (isZodSchema(config.schema)) {
    const result = (config.schema as any).safeParse(data)
    const duration_ms = performance.now() - start

    if (result.success) {
      return { gate, passed: true, duration_ms }
    }

    const issues = result.error.issues
    const reason = issues
      .map((i: any) => `${i.path.join('.')}: ${i.message}`)
      .join('; ')

    return {
      gate,
      passed: false,
      reason: `Schema validation failed: ${reason}`,
      details: issues,
      duration_ms,
    }
  }

  // Simple object mode
  const simpleSchema = config.schema as { required?: string[]; properties?: Record<string, any> }
  const duration_ms_fn = () => performance.now() - start

  if (data === null || data === undefined || typeof data !== 'object' || Array.isArray(data)) {
    return {
      gate,
      passed: false,
      reason: `Expected an object, got ${data === null ? 'null' : Array.isArray(data) ? 'array' : typeof data}`,
      duration_ms: duration_ms_fn(),
    }
  }

  const required = simpleSchema.required ?? []
  const obj = data as Record<string, unknown>
  const missing = required.filter((key) => !(key in obj) || obj[key] === undefined)

  if (missing.length > 0) {
    return {
      gate,
      passed: false,
      reason: `Missing required field${missing.length > 1 ? 's' : ''}: ${missing.map((f) => `"${f}"`).join(', ')}`,
      details: { missing },
      duration_ms: duration_ms_fn(),
    }
  }

  return { gate, passed: true, duration_ms: duration_ms_fn() }
}
