import type Database from 'better-sqlite3'
import { ulid } from './id.js'
import type { TaskStore, Task, CreateTaskInput } from './task-store.js'
import { TaskStatus } from './state-machine.js'

export type CreatePipelineTask = Omit<CreateTaskInput, 'depends_on' | 'pipeline_id' | 'pipeline_step'>

export interface DagNode {
  key: string
  type: string
  summary: string
  prompt: string
  backend: string
  depends_on?: string[]
  priority?: number
  acceptance_criteria?: string[]
  definition_of_done?: string[]
  max_attempts?: number
  max_bounces?: number
  expand?: boolean
  expand_config?: { mode?: string }
  auto_review?: Record<string, unknown>
  metadata?: Record<string, unknown>
}

export interface CreateDagPipelineInput {
  tasks: DagNode[]
}

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

export function createDagPipeline(
  store: TaskStore,
  input: CreateDagPipelineInput,
  db?: Database.Database,
): Task[] {
  const { tasks: nodes } = input

  if (nodes.length === 0) {
    throw new Error('Pipeline must have at least one task')
  }

  // Validate unique keys
  const keys = new Set<string>()
  for (const node of nodes) {
    if (keys.has(node.key)) {
      throw new Error(`Duplicate key: ${node.key}`)
    }
    keys.add(node.key)
  }

  // Validate depends_on references
  for (const node of nodes) {
    for (const dep of node.depends_on ?? []) {
      if (dep === node.key) {
        throw new Error(`Self-dependency: ${node.key}`)
      }
      if (!keys.has(dep)) {
        throw new Error(`Unknown dependency: ${dep} (referenced by ${node.key})`)
      }
    }
  }

  // Build adjacency map and check for cycles
  const adjMap = new Map<string, string[]>()
  for (const node of nodes) {
    adjMap.set(node.key, node.depends_on ?? [])
  }
  assertDagNoCycle(adjMap)

  // Verify at least one root node
  const roots = nodes.filter(n => !n.depends_on || n.depends_on.length === 0)
  if (roots.length === 0) {
    throw new Error('Pipeline has no root node (every task has dependencies)')
  }

  // Topological sort — compute step numbers
  const stepMap = new Map<string, number>()
  const computeStep = (key: string): number => {
    if (stepMap.has(key)) return stepMap.get(key)!
    const deps = adjMap.get(key) ?? []
    if (deps.length === 0) {
      stepMap.set(key, 0)
      return 0
    }
    const maxDepStep = Math.max(...deps.map(computeStep))
    const step = maxDepStep + 1
    stepMap.set(key, step)
    return step
  }
  for (const node of nodes) {
    computeStep(node.key)
  }

  // Sort nodes by step for creation order (parents before children)
  const sorted = [...nodes].sort((a, b) => stepMap.get(a.key)! - stepMap.get(b.key)!)

  // Create tasks — wrap in transaction if db provided
  const createAll = () => {
    const pipelineId = ulid()
    const keyToId = new Map<string, string>()
    const created: Task[] = []

    for (const node of sorted) {
      const dependsOnIds = (node.depends_on ?? []).map(k => keyToId.get(k)!)
      const taskInput: CreateTaskInput = {
        type: node.type,
        summary: node.summary,
        prompt: node.prompt,
        backend: node.backend,
        pipeline_id: pipelineId,
        pipeline_step: stepMap.get(node.key)!,
        depends_on: dependsOnIds,
      }
      if (node.priority !== undefined) taskInput.priority = node.priority
      if (node.acceptance_criteria) taskInput.acceptance_criteria = node.acceptance_criteria
      if (node.definition_of_done) taskInput.definition_of_done = node.definition_of_done
      if (node.max_attempts !== undefined) taskInput.max_attempts = node.max_attempts
      if (node.max_bounces !== undefined) taskInput.max_bounces = node.max_bounces
      if (node.auto_review) taskInput.auto_review = node.auto_review
      const nodeMetadata: Record<string, unknown> = { ...(node.metadata ?? {}) }
      if (node.expand) nodeMetadata.expand = true
      if (node.expand_config) nodeMetadata.expand_config = node.expand_config
      if (Object.keys(nodeMetadata).length > 0) taskInput.metadata = nodeMetadata

      const task = store.create(taskInput)
      keyToId.set(node.key, task.id)
      created.push(task)
    }

    return created
  }

  if (db) {
    return db.transaction(createAll)()
  }
  return createAll()
}

function assertDagNoCycle(adjMap: Map<string, string[]>): void {
  const visiting = new Set<string>()
  const visited = new Set<string>()

  const dfs = (key: string): void => {
    if (visited.has(key)) return
    if (visiting.has(key)) {
      throw new Error(`Cycle detected involving: ${key}`)
    }
    visiting.add(key)
    for (const dep of adjMap.get(key) ?? []) {
      dfs(dep)
    }
    visiting.delete(key)
    visited.add(key)
  }

  for (const key of adjMap.keys()) {
    dfs(key)
  }
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
