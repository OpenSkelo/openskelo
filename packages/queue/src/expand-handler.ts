import type { TaskStore, Task, CreateTaskInput } from './task-store.js'
import type { AuditLog } from './audit.js'

const MAX_EXPANDED_TASKS = 20

export interface ExpandedTask {
  type?: string
  summary: string
  prompt: string
  backend?: string
  priority?: number
  acceptance_criteria?: string[]
  definition_of_done?: string[]
  metadata?: Record<string, unknown>
}

export function parseExpandOutput(result: string): ExpandedTask[] {
  const jsonMatch = result.match(/```(?:json)?\s*([\s\S]*?)```/)
  const jsonStr = jsonMatch ? jsonMatch[1].trim() : result.trim()

  let parsed: unknown
  try {
    parsed = JSON.parse(jsonStr)
  } catch {
    throw new Error('Expand output is not valid JSON')
  }

  const tasks = Array.isArray(parsed)
    ? parsed
    : (parsed as Record<string, unknown>)?.tasks

  if (!Array.isArray(tasks)) {
    throw new Error('Expand output must be an array or { tasks: [...] }')
  }

  if (tasks.length === 0) {
    throw new Error('Expand output contains no tasks')
  }

  const cappedTasks = tasks.slice(0, MAX_EXPANDED_TASKS)

  return cappedTasks.map((t, i) => {
    if (!t || typeof t !== 'object') {
      throw new Error(`Expand task ${i} is not an object`)
    }
    const obj = t as Record<string, unknown>
    if (!obj.summary || !obj.prompt) {
      throw new Error(
        `Expand task ${i} missing required fields (summary, prompt)`,
      )
    }
    const expanded: ExpandedTask = {
      summary: String(obj.summary),
      prompt: String(obj.prompt),
    }
    if (obj.type !== undefined) expanded.type = String(obj.type)
    if (obj.backend !== undefined) expanded.backend = String(obj.backend)
    if (obj.priority !== undefined) expanded.priority = Number(obj.priority)
    if (Array.isArray(obj.acceptance_criteria)) {
      expanded.acceptance_criteria = obj.acceptance_criteria.map(String)
    }
    if (Array.isArray(obj.definition_of_done)) {
      expanded.definition_of_done = obj.definition_of_done.map(String)
    }
    if (obj.metadata && typeof obj.metadata === 'object') {
      expanded.metadata = obj.metadata as Record<string, unknown>
    }
    return expanded
  })
}

export class ExpandHandler {
  private taskStore: TaskStore
  private auditLog: AuditLog

  constructor(taskStore: TaskStore, auditLog: AuditLog) {
    this.taskStore = taskStore
    this.auditLog = auditLog
  }

  onExpandComplete(task: Task): void {
    if (!task.result) {
      this.auditLog.logAction({
        task_id: task.id,
        action: 'expand_skipped_no_result',
        metadata: {},
      })
      return
    }

    const existingChildren = this.taskStore.list({})
      .filter(t => t.parent_task_id === task.id && t.metadata?.expanded_from === task.id)
    if (existingChildren.length > 0) {
      this.auditLog.logAction({
        task_id: task.id,
        action: 'expand_already_applied',
        metadata: { existing_children: existingChildren.length },
      })
      return
    }

    let expandedTasks: ExpandedTask[]
    try {
      expandedTasks = parseExpandOutput(task.result)
    } catch (err) {
      this.auditLog.logAction({
        task_id: task.id,
        action: 'expand_parse_error',
        metadata: { error: (err as Error).message },
      })
      return
    }

    const expandConfig = task.metadata?.expand_config as
      | Record<string, unknown>
      | undefined
    const mode = String(expandConfig?.mode ?? 'sequential')
    const createdTasks: Task[] = []

    for (let i = 0; i < expandedTasks.length; i++) {
      const def = expandedTasks[i]
      const dependsOn: string[] = []

      if (mode === 'sequential' && createdTasks.length > 0) {
        dependsOn.push(createdTasks[createdTasks.length - 1].id)
      }

      const input: CreateTaskInput = {
        type: def.type ?? task.type,
        summary: def.summary,
        prompt: def.prompt,
        backend: def.backend ?? task.backend,
        priority: def.priority ?? task.priority,
        acceptance_criteria: def.acceptance_criteria,
        definition_of_done: def.definition_of_done,
        pipeline_id: task.pipeline_id ?? undefined,
        pipeline_step: (task.pipeline_step ?? 0) + 1 + (mode === 'sequential' ? i : 0),
        parent_task_id: task.id,
        depends_on: dependsOn.length > 0 ? dependsOn : undefined,
        metadata: {
          ...(def.metadata ?? {}),
          expanded_from: task.id,
          expand_index: i,
        },
        auto_review: task.auto_review ?? undefined,
      }

      const created = this.taskStore.create(input)
      createdTasks.push(created)
    }

    // Rewire downstream: tasks that depended on expand task now depend on expanded children
    if (task.pipeline_id) {
      const pipelineTasks = this.taskStore.list({
        pipeline_id: task.pipeline_id,
      })
      const createdIds = new Set(createdTasks.map(t => t.id))
      const downstream = pipelineTasks.filter(
        t => t.depends_on.includes(task.id) && !createdIds.has(t.id),
      )

      if (downstream.length > 0) {
        const newDeps =
          mode === 'sequential'
            ? [createdTasks[createdTasks.length - 1].id]
            : createdTasks.map(t => t.id)

        for (const d of downstream) {
          const updatedDeps = [
            ...d.depends_on.filter(dep => dep !== task.id),
            ...newDeps,
          ]
          this.taskStore.update(d.id, {
            depends_on: [...new Set(updatedDeps)],
          })
        }
      }
    }

    this.auditLog.logAction({
      task_id: task.id,
      action: 'expand_complete',
      metadata: {
        mode,
        created_count: createdTasks.length,
        created_ids: createdTasks.map(t => t.id),
      },
    })
  }
}
