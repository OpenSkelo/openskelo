import type { ExecutionAdapter } from '@openskelo/adapters'
import type Database from 'better-sqlite3'
import { createDatabase } from './db.js'
import { TaskStore } from './task-store.js'
import { PriorityQueue } from './priority-queue.js'
import { AuditLog } from './audit.js'
import { Dispatcher } from './dispatcher.js'
import type { DispatcherConfig } from './dispatcher.js'
import { Watchdog } from './watchdog.js'
import type { WatchdogConfig } from './watchdog.js'
import { createApiRouter } from './api.js'
import type { ApiConfig } from './api.js'
import { createDashboardRouter } from './dashboard.js'
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
  }
  watchdog?: {
    interval_seconds?: number
    on_lease_expire?: 'requeue' | 'block'
  }
  server?: {
    port?: number
    host?: string
    api_key?: string
  }
}

export interface Queue {
  db: Database.Database
  taskStore: TaskStore
  priorityQueue: PriorityQueue
  auditLog: AuditLog
  dispatcher: Dispatcher
  watchdog: Watchdog
  start(): void
  stop(): void
  listen(): Promise<{ port: number; close: () => void }>
}

export function createQueue(config: QueueConfig): Queue {
  const db = createDatabase(config.db_path)
  const taskStore = new TaskStore(db)
  const priorityQueue = new PriorityQueue(db)
  const auditLog = new AuditLog(db)

  const adapters = config.adapters ?? []
  const leaseTtlMs = (config.leases?.ttl_seconds ?? 1200) * 1000
  const heartbeatIntervalMs = (config.leases?.heartbeat_interval_seconds ?? 60) * 1000
  const gracePeriodMs = (config.leases?.grace_period_seconds ?? 30) * 1000

  const dispatcherConfig: DispatcherConfig = {
    poll_interval_ms: (config.dispatcher?.poll_interval_seconds ?? 5) * 1000,
    lease_ttl_ms: leaseTtlMs,
    heartbeat_interval_ms: heartbeatIntervalMs,
    wip_limits: config.wip_limits ?? { default: 1 },
  }

  const watchdogConfig: WatchdogConfig = {
    interval_ms: (config.watchdog?.interval_seconds ?? 30) * 1000,
    grace_period_ms: gracePeriodMs,
    on_lease_expire: config.watchdog?.on_lease_expire ?? 'requeue',
  }

  const dispatcher = new Dispatcher(
    taskStore,
    priorityQueue,
    auditLog,
    adapters,
    dispatcherConfig,
  )

  const watchdog = new Watchdog(taskStore, auditLog, watchdogConfig)

  return {
    db,
    taskStore,
    priorityQueue,
    auditLog,
    dispatcher,
    watchdog,

    start() {
      dispatcher.start()
      watchdog.start()
    },

    stop() {
      dispatcher.stop()
      watchdog.stop()
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
        { taskStore, priorityQueue, auditLog, dispatcher },
        apiConfig,
      ))
      app.use(createDashboardRouter())

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
