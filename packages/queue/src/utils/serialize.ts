import { TaskStatus } from '../state-machine.js'

export const TASK_JSON_COLUMNS = [
  'acceptance_criteria',
  'definition_of_done',
  'backend_config',
  'feedback_history',
  'depends_on',
  'gates',
  'metadata',
] as const

export function serializeJson(value: unknown): string | null {
  if (value === null || value === undefined) return null
  return JSON.stringify(value)
}

export function parseJsonOr<T>(value: string | null, fallback: T): T {
  if (value === null || value === undefined) return fallback
  try {
    return JSON.parse(value) as T
  } catch {
    return fallback
  }
}

export function deserializeTaskRow(row: Record<string, unknown>): Record<string, unknown> {
  return {
    ...row,
    status: row.status as TaskStatus,
    acceptance_criteria: parseJsonOr(row.acceptance_criteria as string | null, []),
    definition_of_done: parseJsonOr(row.definition_of_done as string | null, []),
    backend_config: parseJsonOr(row.backend_config as string | null, null),
    feedback_history: parseJsonOr(row.feedback_history as string | null, []),
    depends_on: parseJsonOr(row.depends_on as string | null, []),
    gates: parseJsonOr(row.gates as string | null, []),
    metadata: parseJsonOr(row.metadata as string | null, {}),
  }
}
