import { Router } from 'express'
import type { Request, Response, NextFunction } from 'express'
import type { TaskStore } from './task-store.js'
import type { PriorityQueue } from './priority-queue.js'
import type { AuditLog } from './audit.js'
import type { Dispatcher } from './dispatcher.js'
import { TaskStatus } from './state-machine.js'
import { TransitionError } from './errors.js'
import { createDagPipeline } from './pipeline.js'
import type { CreateDagPipelineInput } from './pipeline.js'

export interface ApiConfig {
  api_key?: string
  lease_ttl_ms?: number
}

export interface ApiDependencies {
  taskStore: TaskStore
  priorityQueue: PriorityQueue
  auditLog: AuditLog
  dispatcher: Dispatcher
}

const PUBLIC_PATHS = ['/health', '/dashboard']

function paramId(req: Request): string {
  return req.params.id as string
}

function authMiddleware(apiKey: string) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (PUBLIC_PATHS.some(p => req.path === p || req.path.startsWith(p))) {
      next()
      return
    }

    const provided = req.headers['x-api-key']
    if (provided !== apiKey) {
      res.status(401).json({ error: 'Unauthorized: invalid or missing API key' })
      return
    }

    next()
  }
}

export function createApiRouter(
  deps: ApiDependencies,
  config?: ApiConfig,
): Router {
  const router = Router()
  const { taskStore, priorityQueue, auditLog, dispatcher } = deps

  if (config?.api_key) {
    router.use(authMiddleware(config.api_key))
  }

  const leaseTtlMs = config?.lease_ttl_ms ?? 1200000

  // GET /health
  router.get('/health', (_req: Request, res: Response) => {
    try {
      const counts = {
        [TaskStatus.PENDING]: taskStore.count({ status: TaskStatus.PENDING }),
        [TaskStatus.IN_PROGRESS]: taskStore.count({ status: TaskStatus.IN_PROGRESS }),
        [TaskStatus.REVIEW]: taskStore.count({ status: TaskStatus.REVIEW }),
        [TaskStatus.DONE]: taskStore.count({ status: TaskStatus.DONE }),
        [TaskStatus.BLOCKED]: taskStore.count({ status: TaskStatus.BLOCKED }),
      }
      res.json({ status: 'ok', counts })
    } catch (err) {
      res.status(500).json({ error: 'Internal server error' })
    }
  })

  // POST /tasks/claim-next (must come before /tasks/:id routes)
  router.post('/tasks/claim-next', (req: Request, res: Response) => {
    try {
      const { type, lease_owner } = req.body ?? {}

      if (!lease_owner) {
        res.status(400).json({ error: 'lease_owner is required' })
        return
      }

      const next = priorityQueue.getNext(type ? { type } : undefined)
      if (!next) {
        res.status(404).json({ error: 'No pending tasks available' })
        return
      }

      const leaseExpiresAt = new Date(Date.now() + leaseTtlMs).toISOString()
      const task = taskStore.transition(next.id, TaskStatus.IN_PROGRESS, {
        lease_owner,
        lease_expires_at: leaseExpiresAt,
      })

      res.json(task)
    } catch (err) {
      if (err instanceof TransitionError) {
        res.status(409).json({ error: err.message })
        return
      }
      res.status(500).json({ error: 'Internal server error' })
    }
  })

  // POST /tasks
  router.post('/tasks', (req: Request, res: Response) => {
    try {
      const body = req.body ?? {}
      if (!body.type || !body.summary || !body.prompt || !body.backend) {
        res.status(400).json({
          error: 'Missing required fields: type, summary, prompt, backend',
        })
        return
      }

      const task = taskStore.create(body)
      res.status(201).json(task)
    } catch (err) {
      res.status(500).json({ error: 'Internal server error' })
    }
  })

  // GET /tasks
  router.get('/tasks', (req: Request, res: Response) => {
    try {
      const filters: Record<string, unknown> = {}

      const status = req.query.status as string | undefined
      if (status) filters.status = status
      const type = req.query.type as string | undefined
      if (type) filters.type = type
      const pipeline_id = req.query.pipeline_id as string | undefined
      if (pipeline_id) filters.pipeline_id = pipeline_id
      const limit = req.query.limit as string | undefined
      if (limit) filters.limit = parseInt(limit, 10)
      const offset = req.query.offset as string | undefined
      if (offset) filters.offset = parseInt(offset, 10)

      const tasks = taskStore.list(filters)
      res.json(tasks)
    } catch (err) {
      res.status(500).json({ error: 'Internal server error' })
    }
  })

  // GET /tasks/:id
  router.get('/tasks/:id', (req: Request, res: Response) => {
    try {
      const id = paramId(req)
      const task = taskStore.getById(id)
      if (!task) {
        res.status(404).json({ error: `Task ${id} not found` })
        return
      }
      res.json(task)
    } catch (err) {
      res.status(500).json({ error: 'Internal server error' })
    }
  })

  // PATCH /tasks/:id/priority
  router.patch('/tasks/:id/priority', (req: Request, res: Response) => {
    try {
      const id = paramId(req)
      const { priority } = req.body ?? {}
      if (priority === undefined || typeof priority !== 'number') {
        res.status(400).json({ error: 'priority (number) is required' })
        return
      }

      const existing = taskStore.getById(id)
      if (!existing) {
        res.status(404).json({ error: `Task ${id} not found` })
        return
      }

      const task = taskStore.update(id, { priority })
      res.json(task)
    } catch (err) {
      res.status(500).json({ error: 'Internal server error' })
    }
  })

  // PATCH /tasks/:id/reorder
  router.patch('/tasks/:id/reorder', (req: Request, res: Response) => {
    try {
      const { position } = req.body ?? {}
      if (!position) {
        res.status(400).json({ error: 'position is required' })
        return
      }

      priorityQueue.reorder(paramId(req), position)
      res.json({ ok: true })
    } catch (err) {
      if (err instanceof Error && err.message.includes('not found')) {
        res.status(404).json({ error: err.message })
        return
      }
      res.status(500).json({ error: 'Internal server error' })
    }
  })

  // POST /tasks/:id/transition
  router.post('/tasks/:id/transition', (req: Request, res: Response) => {
    try {
      const { to, ...context } = req.body ?? {}
      if (!to) {
        res.status(400).json({ error: 'to (target status) is required' })
        return
      }

      const id = paramId(req)
      const existing = taskStore.getById(id)
      if (!existing) {
        res.status(404).json({ error: `Task ${id} not found` })
        return
      }

      const task = taskStore.transition(id, to, context)
      res.json(task)
    } catch (err) {
      if (err instanceof TransitionError) {
        res.status(409).json({ error: err.message })
        return
      }
      res.status(500).json({ error: 'Internal server error' })
    }
  })

  // POST /tasks/:id/heartbeat
  router.post('/tasks/:id/heartbeat', (req: Request, res: Response) => {
    try {
      dispatcher.heartbeat(paramId(req))
      res.json({ ok: true })
    } catch (err) {
      if (err instanceof Error && err.message.includes('not found')) {
        res.status(404).json({ error: err.message })
        return
      }
      res.status(500).json({ error: 'Internal server error' })
    }
  })

  // POST /tasks/:id/release
  router.post('/tasks/:id/release', (req: Request, res: Response) => {
    try {
      const { error } = req.body ?? {}
      dispatcher.release(paramId(req), error)
      res.json({ ok: true })
    } catch (err) {
      if (err instanceof Error && err.message.includes('not found')) {
        res.status(404).json({ error: err.message })
        return
      }
      res.status(500).json({ error: 'Internal server error' })
    }
  })

  // POST /pipelines
  router.post('/pipelines', (req: Request, res: Response) => {
    try {
      const body = req.body as CreateDagPipelineInput
      if (!body?.tasks || !Array.isArray(body.tasks) || body.tasks.length === 0) {
        res.status(400).json({ error: 'tasks array is required' })
        return
      }

      for (const node of body.tasks) {
        if (!node.key || !node.type || !node.summary || !node.prompt || !node.backend) {
          res.status(400).json({
            error: `Task "${node.key || '?'}" missing required fields: key, type, summary, prompt, backend`,
          })
          return
        }
      }

      const tasks = createDagPipeline(taskStore, body)
      res.status(201).json({
        pipeline_id: tasks[0].pipeline_id,
        tasks,
      })
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Internal server error'
      if (msg.includes('Duplicate key') || msg.includes('Unknown dependency') ||
          msg.includes('Cycle detected') || msg.includes('Self-dependency') ||
          msg.includes('no root node') || msg.includes('at least one')) {
        res.status(400).json({ error: msg })
        return
      }
      res.status(500).json({ error: 'Internal server error' })
    }
  })

  // GET /pipelines
  router.get('/pipelines', (_req: Request, res: Response) => {
    try {
      const allTasks = taskStore.list({})
      const pipelineMap = new Map<string, { total: number; completed: number }>()

      for (const task of allTasks) {
        if (!task.pipeline_id) continue
        const entry = pipelineMap.get(task.pipeline_id) ?? { total: 0, completed: 0 }
        entry.total++
        if (task.status === TaskStatus.DONE) entry.completed++
        pipelineMap.set(task.pipeline_id, entry)
      }

      const pipelines = Array.from(pipelineMap.entries()).map(([pipeline_id, info]) => ({
        pipeline_id,
        task_count: info.total,
        completed: info.completed,
        status: info.completed === info.total ? 'completed' : 'active',
      }))

      const statusFilter = (_req.query.status as string | undefined)
      if (statusFilter) {
        res.json(pipelines.filter(p => p.status === statusFilter))
        return
      }

      res.json(pipelines)
    } catch (err) {
      res.status(500).json({ error: 'Internal server error' })
    }
  })

  // GET /pipelines/:id
  router.get('/pipelines/:id', (req: Request, res: Response) => {
    try {
      const pipelineId = paramId(req)
      const tasks = taskStore.list({ pipeline_id: pipelineId })
      if (tasks.length === 0) {
        res.status(404).json({ error: `Pipeline ${pipelineId} not found` })
        return
      }
      // Sort by pipeline_step
      tasks.sort((a, b) => (a.pipeline_step ?? 0) - (b.pipeline_step ?? 0))
      res.json(tasks)
    } catch (err) {
      res.status(500).json({ error: 'Internal server error' })
    }
  })

  // GET /audit
  router.get('/audit', (req: Request, res: Response) => {
    try {
      const opts: Record<string, unknown> = {}

      const task_id = req.query.task_id as string | undefined
      if (task_id) opts.task_id = task_id
      const limit = req.query.limit as string | undefined
      if (limit) opts.limit = parseInt(limit, 10)
      const offset = req.query.offset as string | undefined
      if (offset) opts.offset = parseInt(offset, 10)

      const entries = auditLog.getLog(opts)
      res.json(entries)
    } catch (err) {
      res.status(500).json({ error: 'Internal server error' })
    }
  })

  return router
}
