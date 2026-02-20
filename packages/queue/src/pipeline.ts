import { ulid } from './id.js'
import type { TaskStore, Task, CreateTaskInput } from './task-store.js'
import { TaskStatus } from './state-machine.js'

export type CreatePipelineTask = Omit<CreateTaskInput, 'depends_on' | 'pipeline_id' | 'pipeline_step'>

export function createPipeline(
  store: TaskStore,
  steps: CreatePipelineTask[],
): Task[] {
  const pipelineId = ulid()
  const tasks: Task[] = []

  for (let i = 0; i < steps.length; i++) {
    const depends_on = i > 0 ? [tasks[i - 1].id] : []
    const task = store.create({
      ...steps[i],
      pipeline_id: pipelineId,
      pipeline_step: i + 1,
      depends_on,
    })
    tasks.push(task)
  }

  return tasks
}

export function areDependenciesMet(task: Task, store: TaskStore): boolean {
  if (!task.depends_on || task.depends_on.length === 0) return true

  for (const depId of task.depends_on) {
    const dep = store.getById(depId)
    if (!dep || dep.status !== TaskStatus.DONE) return false
  }

  return true
}

export function getUpstreamResults(
  task: Task,
  store: TaskStore,
): Record<string, unknown> {
  if (!task.depends_on || task.depends_on.length === 0) return {}

  const results: Record<string, unknown> = {}
  for (const depId of task.depends_on) {
    const dep = store.getById(depId)
    if (dep?.result) {
      try {
        results[depId] = JSON.parse(dep.result)
      } catch {
        results[depId] = dep.result
      }
    }
  }

  return results
}
