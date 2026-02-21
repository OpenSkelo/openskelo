import type { ExecutionAdapter, TaskInput } from '@openskelo/adapters'
import type { TaskStore, Task } from './task-store.js'
import type { PriorityQueue } from './priority-queue.js'
import type { AuditLog } from './audit.js'
import { TaskStatus } from './state-machine.js'
import { areDependenciesMet, getUpstreamResults } from './pipeline.js'

export interface DispatcherConfig {
  poll_interval_ms: number
  lease_ttl_ms: number
  heartbeat_interval_ms: number
  wip_limits: Record<string, number>
  onError?: (error: Error) => void
}

export interface DispatchResult {
  taskId: string
  adapterId: string
  action: 'dispatched' | 'wip_limited' | 'no_eligible'
}

function taskToInput(task: Task, upstreamResults: Record<string, unknown>): TaskInput {
  const input: TaskInput = {
    id: task.id,
    type: task.type,
    summary: task.summary,
    prompt: task.prompt,
    backend: task.backend,
  }

  if (task.acceptance_criteria.length > 0) {
    input.acceptance_criteria = task.acceptance_criteria
  }
  if (task.definition_of_done.length > 0) {
    input.definition_of_done = task.definition_of_done
  }
  if (task.backend_config) {
    input.backend_config = task.backend_config as TaskInput['backend_config']
  }
  if (Object.keys(upstreamResults).length > 0) {
    input.upstream_results = upstreamResults
  }

  // Backend model routing: "openrouter/anthropic/claude-opus-4-5" → backend="openrouter", model override
  if (task.backend.includes('/')) {
    const slashIndex = task.backend.indexOf('/')
    input.backend = task.backend.slice(0, slashIndex)
    const modelOverride = task.backend.slice(slashIndex + 1)
    input.backend_config = {
      ...input.backend_config,
      model: modelOverride,
    }
  }

  return input
}

export class Dispatcher {
  private taskStore: TaskStore
  private priorityQueue: PriorityQueue
  private auditLog: AuditLog
  private adapters: ExecutionAdapter[]
  private config: DispatcherConfig
  private intervalId: ReturnType<typeof setInterval> | null = null

  constructor(
    taskStore: TaskStore,
    priorityQueue: PriorityQueue,
    auditLog: AuditLog,
    adapters: ExecutionAdapter[],
    config: DispatcherConfig,
  ) {
    this.taskStore = taskStore
    this.priorityQueue = priorityQueue
    this.auditLog = auditLog
    this.adapters = adapters
    this.config = config
  }

  async tick(): Promise<DispatchResult[]> {
    const results: DispatchResult[] = []
    const claimedIds: string[] = []

    for (const adapter of this.adapters) {
      // Check WIP limit for each task type this adapter handles
      let hasCapacity = true
      for (const taskType of adapter.taskTypes) {
        const wipCount = this.taskStore.count({
          status: TaskStatus.IN_PROGRESS,
          type: taskType,
        })
        const limit = this.config.wip_limits[taskType]
          ?? this.config.wip_limits['default']
          ?? 1
        if (wipCount >= limit) {
          hasCapacity = false
          break
        }
      }

      if (!hasCapacity) {
        results.push({
          taskId: '',
          adapterId: adapter.name,
          action: 'wip_limited',
        })
        continue
      }

      // Find next eligible PENDING task for this adapter's types
      let candidate: Task | null = null
      const excludeIds = [...claimedIds]

      for (const taskType of adapter.taskTypes) {
        const next = this.priorityQueue.getNext({
          type: taskType,
          excludeIds,
        })
        if (!next) continue

        // Check dependencies
        if (!areDependenciesMet(next, this.taskStore)) {
          continue
        }

        // Backend routing: task backend always targets a specific adapter.
        const targetAdapter = next.backend.includes('/')
          ? next.backend.split('/')[0]
          : next.backend
        if (targetAdapter !== adapter.name) continue

        candidate = next
        break
      }

      if (!candidate) {
        continue
      }

      // Claim: transition PENDING → IN_PROGRESS atomically with lease fields
      try {
        const leaseExpiry = new Date(Date.now() + this.config.lease_ttl_ms).toISOString()

        this.taskStore.transition(candidate.id, TaskStatus.IN_PROGRESS, {
          lease_owner: adapter.name,
          lease_expires_at: leaseExpiry,
        })

        claimedIds.push(candidate.id)

        // Log dispatch audit
        this.auditLog.logAction({
          task_id: candidate.id,
          action: 'dispatch',
          actor: adapter.name,
          before_state: TaskStatus.PENDING,
          after_state: TaskStatus.IN_PROGRESS,
        })

        results.push({
          taskId: candidate.id,
          adapterId: adapter.name,
          action: 'dispatched',
        })

        // Fire-and-forget async execution
        const taskId = candidate.id
        const upstreamResults = getUpstreamResults(candidate, this.taskStore)
        const taskInput = taskToInput(candidate, upstreamResults)

        const executionPromise = adapter.execute(taskInput)
        const heartbeatInterval = setInterval(() => {
          try {
            this.heartbeat(taskId)
          } catch {
            // Best effort — heartbeat failures should not crash execution
          }
        }, this.config.heartbeat_interval_ms)

        const clearHeartbeat = () => {
          clearInterval(heartbeatInterval)
        }

        void executionPromise.then((adapterResult) => {
          clearHeartbeat()

          // On success, transition to REVIEW
          try {
            this.taskStore.transition(taskId, TaskStatus.REVIEW, {
              result: adapterResult.output,
            })
            this.auditLog.logAction({
              task_id: taskId,
              action: 'execution_complete',
              actor: adapter.name,
              before_state: TaskStatus.IN_PROGRESS,
              after_state: TaskStatus.REVIEW,
              metadata: {
                exit_code: adapterResult.exit_code,
                duration_ms: adapterResult.duration_ms,
              },
            })
          } catch {
            // Transition failed, try to release
            try {
              this.release(taskId, 'Failed to transition to REVIEW')
            } catch {
              // Best effort
            }
          }
        }).catch((err: Error) => {
          clearHeartbeat()

          // On error, release lease
          try {
            this.release(taskId, err.message)
          } catch {
            // Best effort — task may already be transitioned
          }
        })
      } catch {
        // Claim failed (e.g., concurrent modification)
        continue
      }
    }

    return results
  }

  start(): void {
    if (this.intervalId) return
    this.intervalId = setInterval(() => {
      void this.tick().catch((err: unknown) => {
        this.handleError(err)
      })
    }, this.config.poll_interval_ms)
  }

  stop(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId)
      this.intervalId = null
    }
  }

  private handleError(err: unknown): void {
    const error = err instanceof Error ? err : new Error(String(err))
    this.config.onError?.(error)
  }

  heartbeat(taskId: string): void {
    const task = this.taskStore.getById(taskId)
    if (!task) {
      throw new Error(`Task ${taskId} not found`)
    }

    const leaseExpiry = new Date(Date.now() + this.config.lease_ttl_ms).toISOString()
    this.taskStore.update(taskId, { lease_expires_at: leaseExpiry })

    this.auditLog.logAction({
      task_id: taskId,
      action: 'heartbeat',
      actor: task.lease_owner ?? undefined,
      metadata: { lease_expires_at: leaseExpiry },
    })
  }

  release(taskId: string, error?: string): void {
    const task = this.taskStore.getById(taskId)
    if (!task) {
      throw new Error(`Task ${taskId} not found`)
    }

    const beforeState = task.status

    this.taskStore.transition(taskId, TaskStatus.PENDING, {
      last_error: error,
    })

    this.auditLog.logAction({
      task_id: taskId,
      action: 'release',
      actor: task.lease_owner ?? undefined,
      before_state: beforeState,
      after_state: TaskStatus.PENDING,
      metadata: error ? { error } : undefined,
    })
  }
}
