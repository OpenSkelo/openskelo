import type { TaskStore } from './task-store.js'
import type { AuditLog } from './audit.js'
import { TaskStatus } from './state-machine.js'

export interface WatchdogConfig {
  interval_ms: number
  grace_period_ms: number
  on_lease_expire: 'requeue' | 'block'
  onError?: (error: Error) => void
}

export interface WatchdogResult {
  taskId: string
  action: 'requeued' | 'blocked'
  reason: string
}

export class Watchdog {
  private taskStore: TaskStore
  private auditLog: AuditLog
  private config: WatchdogConfig
  private intervalId: ReturnType<typeof setInterval> | null = null

  constructor(
    taskStore: TaskStore,
    auditLog: AuditLog,
    config: WatchdogConfig,
  ) {
    this.taskStore = taskStore
    this.auditLog = auditLog
    this.config = config
  }

  tick(): WatchdogResult[] {
    const results: WatchdogResult[] = []
    const now = Date.now()

    // Get all IN_PROGRESS tasks
    const inProgressTasks = this.taskStore.list({
      status: TaskStatus.IN_PROGRESS,
    })

    for (const task of inProgressTasks) {
      const hasLease = Boolean(task.lease_expires_at)
      const leaseExpiresAt = hasLease
        ? new Date(task.lease_expires_at as string).getTime()
        : Number.NEGATIVE_INFINITY

      // Recover both expired leases and anomalous IN_PROGRESS tasks with no lease.
      if (hasLease && leaseExpiresAt + this.config.grace_period_ms >= now) {
        continue
      }

      const leaseIssue = hasLease
        ? `lease expired at ${task.lease_expires_at}`
        : 'missing lease_expires_at while IN_PROGRESS'

      // Determine action: block if config says block, or if attempts exhausted
      const shouldBlock = this.config.on_lease_expire === 'block'
        || task.attempt_count >= task.max_attempts

      if (shouldBlock) {
        // Transition to BLOCKED
        this.taskStore.transition(task.id, TaskStatus.BLOCKED, {
          reason: `Watchdog: ${
            task.attempt_count >= task.max_attempts
              ? `max attempts exhausted (${task.attempt_count}/${task.max_attempts})`
              : leaseIssue
          }`,
          last_error: `Watchdog: ${leaseIssue}`,
        })

        this.auditLog.logAction({
          task_id: task.id,
          action: 'watchdog_recovery',
          actor: 'watchdog',
          before_state: TaskStatus.IN_PROGRESS,
          after_state: TaskStatus.BLOCKED,
          metadata: {
            lease_expires_at: task.lease_expires_at,
            attempt_count: task.attempt_count,
            max_attempts: task.max_attempts,
            missing_lease: !hasLease,
          },
        })

        results.push({
          taskId: task.id,
          action: 'blocked',
          reason: `Watchdog recovery: ${leaseIssue}; task blocked`,
        })
      } else {
        // Transition to PENDING (requeue)
        this.taskStore.transition(task.id, TaskStatus.PENDING, {
          last_error: `Watchdog: ${leaseIssue}`,
        })

        this.auditLog.logAction({
          task_id: task.id,
          action: 'watchdog_recovery',
          actor: 'watchdog',
          before_state: TaskStatus.IN_PROGRESS,
          after_state: TaskStatus.PENDING,
          metadata: {
            lease_expires_at: task.lease_expires_at,
            attempt_count: task.attempt_count,
            max_attempts: task.max_attempts,
            missing_lease: !hasLease,
          },
        })

        results.push({
          taskId: task.id,
          action: 'requeued',
          reason: `Watchdog recovery: ${leaseIssue}; task requeued`,
        })
      }
    }

    return results
  }

  start(): void {
    if (this.intervalId) return
    this.intervalId = setInterval(() => {
      try {
        this.tick()
      } catch (err) {
        const error = err instanceof Error ? err : new Error(String(err))
        this.config.onError?.(error)
      }
    }, this.config.interval_ms)
  }

  stop(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId)
      this.intervalId = null
    }
  }
}
