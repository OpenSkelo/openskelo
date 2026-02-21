import type { ExecutionAdapter } from '@openskelo/adapters'
import type Database from 'better-sqlite3'
import { createDatabase } from './db.js'
import { TaskStore } from './task-store.js'
import type { Task } from './task-store.js'
import { PriorityQueue } from './priority-queue.js'
import { AuditLog } from './audit.js'
import { Dispatcher } from './dispatcher.js'
import type { DispatcherConfig } from './dispatcher.js'
import { Watchdog } from './watchdog.js'
import type { WatchdogConfig } from './watchdog.js'
import { createApiRouter } from './api.js'
import type { ApiConfig } from './api.js'
import { createDashboardRouter } from './dashboard.js'
import { WebhookDispatcher } from './webhooks.js'
import type { WebhookConfig } from './webhooks.js'
import { TemplateStore } from './templates.js'
import { Scheduler } from './scheduler.js'
import type { ScheduleConfig } from './scheduler.js'
import { ReviewHandler } from './review-handler.js'
import { TaskStatus } from './state-machine.js'
import express from 'express'

export interface QueueConfig {
  db_path: string
  adapters?: ExecutionAdapter[]
  wip_limits?: Record<string, number>
  leases?: {
    ttl_seconds?: number
    heartbeat_interval_seconds?: number
    grace_period_seconds?: number
  }
  dispatcher?: {
    poll_interval_seconds?: number
    on_error?: (error: Error) => void
  }
  watchdog?: {
    interval_seconds?: number
    on_lease_expire?: 'requeue' | 'block'
    on_error?: (error: Error) => void
  }
  server?: {
    port?: number
    host?: string
    api_key?: string
  }
  webhooks?: WebhookConfig[]
  schedules?: ScheduleConfig[]
}

export interface Queue {
  db: Database.Database
  taskStore: TaskStore
  templateStore: TemplateStore
  priorityQueue: PriorityQueue
  auditLog: AuditLog
  dispatcher: Dispatcher
  watchdog: Watchdog
  scheduler: Scheduler
  start(): void
  stop(): void
  listen(): Promise<{ port: number; close: () => void }>
}

export function createQueue(config: QueueConfig): Queue {
  const db = createDatabase(config.db_path)
  const webhookDispatcher = new WebhookDispatcher(config.webhooks ?? [])

  const eventMap: Partial<Record<TaskStatus, string>> = {
    [TaskStatus.REVIEW]: 'review',
    [TaskStatus.BLOCKED]: 'blocked',
    [TaskStatus.DONE]: 'done',
  }

  let taskStoreRef: TaskStore

  const onTransition = (task: Task, _from: TaskStatus, to: TaskStatus) => {
    const eventName = eventMap[to]
    if (!eventName) return

    webhookDispatcher.emit({
      event: eventName,
      task_id: task.id,
      task_summary: task.summary,
      task_type: task.type,
      task_status: to,
      pipeline_id: task.pipeline_id ?? undefined,
      timestamp: new Date().toISOString(),
    })

    // Auto-review: when task reaches REVIEW, create review children
    if (to === TaskStatus.REVIEW) {
      reviewHandler.onTaskReview(task)
    }

    // Auto-review: when review child completes, apply strategy
    if (to === TaskStatus.DONE && task.type === 'review' && task.parent_task_id) {
      reviewHandler.onReviewChildComplete(task)
    }

    // Fix task completion: resolve the parent task
    if (to === TaskStatus.DONE && (task.metadata as Record<string, unknown>)?.fix_for) {
      reviewHandler.onFixComplete(task)
    }

    if (to === TaskStatus.DONE && task.pipeline_id) {
      const pipelineTasks = taskStoreRef.list({ pipeline_id: task.pipeline_id })
      const allDone = pipelineTasks.every(t => t.status === TaskStatus.DONE)
      if (allDone) {
        webhookDispatcher.emit({
          event: 'pipeline_complete',
          task_id: task.id,
          task_summary: `Pipeline ${task.pipeline_id}`,
          task_type: task.type,
          task_status: 'completed',
          pipeline_id: task.pipeline_id,
          pipeline_progress: `${pipelineTasks.length}/${pipelineTasks.length}`,
          timestamp: new Date().toISOString(),
        })
      }
    }
  }

  const auditLog = new AuditLog(db)
  let reviewHandler: ReviewHandler

  const taskStore = new TaskStore(db, { onTransition })
  taskStoreRef = taskStore
  reviewHandler = new ReviewHandler(taskStore, auditLog, webhookDispatcher)
  const templateStore = new TemplateStore(db, taskStore)
  const priorityQueue = new PriorityQueue(db)

  const adapters = config.adapters ?? []
  const leaseTtlMs = (config.leases?.ttl_seconds ?? 1200) * 1000
  const heartbeatIntervalMs = (config.leases?.heartbeat_interval_seconds ?? 60) * 1000
  const gracePeriodMs = (config.leases?.grace_period_seconds ?? 30) * 1000

  const dispatcherConfig: DispatcherConfig = {
    poll_interval_ms: (config.dispatcher?.poll_interval_seconds ?? 5) * 1000,
    lease_ttl_ms: leaseTtlMs,
    heartbeat_interval_ms: heartbeatIntervalMs,
    wip_limits: config.wip_limits ?? { default: 1 },
    onError: config.dispatcher?.on_error,
  }

  const watchdogConfig: WatchdogConfig = {
    interval_ms: (config.watchdog?.interval_seconds ?? 30) * 1000,
    grace_period_ms: gracePeriodMs,
    on_lease_expire: config.watchdog?.on_lease_expire ?? 'requeue',
    onError: config.watchdog?.on_error,
  }

  const dispatcher = new Dispatcher(
    taskStore,
    priorityQueue,
    auditLog,
    adapters,
    dispatcherConfig,
  )

  const watchdog = new Watchdog(taskStore, auditLog, watchdogConfig)
  const scheduler = new Scheduler(templateStore, db, config.schedules ?? [])

  return {
    db,
    taskStore,
    templateStore,
    priorityQueue,
    auditLog,
    dispatcher,
    watchdog,
    scheduler,

    start() {
      dispatcher.start()
      watchdog.start()
      scheduler.start()
    },

    stop() {
      dispatcher.stop()
      watchdog.stop()
      scheduler.stop()
    },

    listen() {
      const app = express()
      app.use(express.json())

      const apiConfig: ApiConfig = {
        lease_ttl_ms: leaseTtlMs,
      }
      if (config.server?.api_key) {
        apiConfig.api_key = config.server.api_key
      }

      app.use(createApiRouter(
        { db, taskStore, templateStore, priorityQueue, auditLog, dispatcher, scheduler, reviewHandler },
        apiConfig,
      ))
      app.use(createDashboardRouter(config.server?.api_key))

      const port = config.server?.port ?? 4820
      const host = config.server?.host ?? '127.0.0.1'

      return new Promise<{ port: number; close: () => void }>((resolve) => {
        const server = app.listen(port, host, () => {
          resolve({
            port,
            close: () => server.close(),
          })
        })
      })
    },
  }
}
