import type { TaskStore } from './task-store.js'
import type { AuditLog } from './audit.js'
import { TaskStatus } from './state-machine.js'

export interface WatchdogConfig {
  interval_ms: number
  grace_period_ms: number
  on_lease_expire: 'requeue' | 'block'
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
      // Skip tasks without a lease expiry
      if (!task.lease_expires_at) continue

      const leaseExpiresAt = new Date(task.lease_expires_at).getTime()

      // Check if lease + grace period has elapsed
      if (leaseExpiresAt + this.config.grace_period_ms >= now) {
        continue
      }

      // Determine action: block if config says block, or if attempts exhausted
      const shouldBlock = this.config.on_lease_expire === 'block'
        || task.attempt_count >= task.max_attempts

      if (shouldBlock) {
        // Transition to BLOCKED
        this.taskStore.transition(task.id, TaskStatus.BLOCKED, {
          reason: `Watchdog: ${
            task.attempt_count >= task.max_attempts
              ? `max attempts exhausted (${task.attempt_count}/${task.max_attempts})`
              : 'lease expired, configured to block'
          }`,
          last_error: `Watchdog: lease expired at ${task.lease_expires_at}`,
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
          },
        })

        results.push({
          taskId: task.id,
          action: 'blocked',
          reason: `Lease expired at ${task.lease_expires_at}, task blocked`,
        })
      } else {
        // Transition to PENDING (requeue)
        this.taskStore.transition(task.id, TaskStatus.PENDING, {
          last_error: `Watchdog: lease expired at ${task.lease_expires_at}`,
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
          },
        })

        results.push({
          taskId: task.id,
          action: 'requeued',
          reason: `Lease expired at ${task.lease_expires_at}, task requeued`,
        })
      }
    }

    return results
  }

  start(): void {
    if (this.intervalId) return
    this.intervalId = setInterval(() => {
      this.tick()
    }, this.config.interval_ms)
  }

  stop(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId)
      this.intervalId = null
    }
  }
}
