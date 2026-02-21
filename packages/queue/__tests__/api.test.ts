import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import express from 'express'
import request from 'supertest'
import type Database from 'better-sqlite3'
import type { ExecutionAdapter, TaskInput, AdapterResult } from '@openskelo/adapters'
import { createDatabase } from '../src/db.js'
import { TaskStore } from '../src/task-store.js'
import type { CreateTaskInput } from '../src/task-store.js'
import { TaskStatus } from '../src/state-machine.js'
import { PriorityQueue } from '../src/priority-queue.js'
import { AuditLog } from '../src/audit.js'
import { Dispatcher } from '../src/dispatcher.js'
import type { DispatcherConfig } from '../src/dispatcher.js'
import { createApiRouter } from '../src/api.js'
import type { ApiDependencies, ApiConfig } from '../src/api.js'

function createHangingAdapter(name: string, taskTypes: string[]): ExecutionAdapter {
  return {
    name,
    taskTypes,
    canHandle: vi.fn((task: TaskInput) => taskTypes.includes(task.type)),
    execute: vi.fn(() => new Promise<AdapterResult>(() => {})),
    abort: vi.fn(async () => {}),
  }
}

function makeTaskInput(overrides: Partial<CreateTaskInput> = {}): CreateTaskInput {
  return {
    type: 'code',
    summary: 'test task',
    prompt: 'do the thing',
    backend: 'claude-code',
    ...overrides,
  }
}

const DEFAULT_CONFIG: DispatcherConfig = {
  poll_interval_ms: 5000,
  lease_ttl_ms: 1200000,
  heartbeat_interval_ms: 60000,
  wip_limits: { default: 2 },
}

function createTestApp(deps: ApiDependencies, config?: ApiConfig) {
  const app = express()
  app.use(express.json())
  app.use(createApiRouter(deps, config))
  return app
}

describe('REST API Router', () => {
  let db: Database.Database
  let taskStore: TaskStore
  let priorityQueue: PriorityQueue
  let auditLog: AuditLog
  let dispatcher: Dispatcher
  let deps: ApiDependencies
  let app: ReturnType<typeof express>

  beforeEach(() => {
    db = createDatabase(':memory:')
    taskStore = new TaskStore(db)
    priorityQueue = new PriorityQueue(db)
    auditLog = new AuditLog(db)
    const adapter = createHangingAdapter('claude-code', ['code'])
    dispatcher = new Dispatcher(taskStore, priorityQueue, auditLog, [adapter], DEFAULT_CONFIG)
    deps = { taskStore, priorityQueue, auditLog, dispatcher }
    app = createTestApp(deps)
  })

  afterEach(() => {
    db.close()
  })

  // 1. POST /tasks creates a task
  it('POST /tasks creates a task', async () => {
    const body = makeTaskInput()
    const res = await request(app)
      .post('/tasks')
      .send(body)
      .expect(201)

    expect(res.body).toHaveProperty('id')
    expect(res.body.type).toBe('code')
    expect(res.body.summary).toBe('test task')
    expect(res.body.status).toBe('PENDING')
  })

  // 2. POST /tasks returns 400 on missing fields
  it('POST /tasks returns 400 on missing fields', async () => {
    const res = await request(app)
      .post('/tasks')
      .send({ type: 'code' })
      .expect(400)

    expect(res.body).toHaveProperty('error')
  })

  // 3. GET /tasks returns all tasks
  it('GET /tasks returns all tasks', async () => {
    taskStore.create(makeTaskInput({ summary: 'task 1' }))
    taskStore.create(makeTaskInput({ summary: 'task 2' }))

    const res = await request(app)
      .get('/tasks')
      .expect(200)

    expect(Array.isArray(res.body)).toBe(true)
    expect(res.body).toHaveLength(2)
  })

  // 4. GET /tasks filters by status
  it('GET /tasks filters by status', async () => {
    const t1 = taskStore.create(makeTaskInput({ summary: 'pending task' }))
    const t2 = taskStore.create(makeTaskInput({ summary: 'in progress task' }))
    taskStore.transition(t2.id, TaskStatus.IN_PROGRESS, { lease_owner: 'test' })

    const res = await request(app)
      .get('/tasks?status=PENDING')
      .expect(200)

    expect(res.body).toHaveLength(1)
    expect(res.body[0].id).toBe(t1.id)
  })

  // 5. GET /tasks/:id returns a task
  it('GET /tasks/:id returns a task', async () => {
    const task = taskStore.create(makeTaskInput())

    const res = await request(app)
      .get(`/tasks/${task.id}`)
      .expect(200)

    expect(res.body.id).toBe(task.id)
    expect(res.body.summary).toBe('test task')
  })

  // 6. GET /tasks/:id returns 404
  it('GET /tasks/:id returns 404 for non-existent task', async () => {
    const res = await request(app)
      .get('/tasks/nonexistent')
      .expect(404)

    expect(res.body).toHaveProperty('error')
  })

  // 7. POST /tasks/:id/transition succeeds
  it('POST /tasks/:id/transition succeeds', async () => {
    const task = taskStore.create(makeTaskInput())

    const res = await request(app)
      .post(`/tasks/${task.id}/transition`)
      .send({ to: 'IN_PROGRESS', lease_owner: 'test-agent' })
      .expect(200)

    expect(res.body.status).toBe('IN_PROGRESS')
  })

  // 8. POST /tasks/:id/transition returns 409
  it('POST /tasks/:id/transition returns 409 on invalid transition', async () => {
    const task = taskStore.create(makeTaskInput())

    const res = await request(app)
      .post(`/tasks/${task.id}/transition`)
      .send({ to: 'DONE' })
      .expect(409)

    expect(res.body).toHaveProperty('error')
  })

  // 9. PATCH /tasks/:id/priority updates priority
  it('PATCH /tasks/:id/priority updates priority', async () => {
    const task = taskStore.create(makeTaskInput())

    const res = await request(app)
      .patch(`/tasks/${task.id}/priority`)
      .send({ priority: 5 })
      .expect(200)

    expect(res.body.priority).toBe(5)
  })

  // 10. PATCH /tasks/:id/reorder moves task
  it('PATCH /tasks/:id/reorder moves task to top', async () => {
    const t1 = taskStore.create(makeTaskInput({ summary: 'first' }))
    const t2 = taskStore.create(makeTaskInput({ summary: 'second' }))

    const res = await request(app)
      .patch(`/tasks/${t2.id}/reorder`)
      .send({ position: { top: true } })
      .expect(200)

    expect(res.body).toHaveProperty('ok', true)

    // Verify t2 is now first in queue
    const next = priorityQueue.getNext()
    expect(next!.id).toBe(t2.id)
  })

  // 11. POST /tasks/:id/heartbeat extends lease
  it('POST /tasks/:id/heartbeat extends lease', async () => {
    const task = taskStore.create(makeTaskInput())
    taskStore.transition(task.id, TaskStatus.IN_PROGRESS, { lease_owner: 'test' })
    const leaseExpiry = new Date(Date.now() + 1200000).toISOString()
    taskStore.update(task.id, { lease_expires_at: leaseExpiry })

    const res = await request(app)
      .post(`/tasks/${task.id}/heartbeat`)
      .expect(200)

    expect(res.body).toHaveProperty('ok', true)
  })

  // 12. POST /tasks/:id/release requeues task
  it('POST /tasks/:id/release requeues task', async () => {
    const task = taskStore.create(makeTaskInput())
    taskStore.transition(task.id, TaskStatus.IN_PROGRESS, { lease_owner: 'test' })

    const res = await request(app)
      .post(`/tasks/${task.id}/release`)
      .send({ error: 'something went wrong' })
      .expect(200)

    expect(res.body).toHaveProperty('ok', true)

    const updated = taskStore.getById(task.id)!
    expect(updated.status).toBe('PENDING')
  })

  // 13. POST /tasks/claim-next claims task
  it('POST /tasks/claim-next claims task', async () => {
    const task = taskStore.create(makeTaskInput())

    const res = await request(app)
      .post('/tasks/claim-next')
      .send({ lease_owner: 'my-agent' })
      .expect(200)

    expect(res.body.id).toBe(task.id)
    expect(res.body.status).toBe('IN_PROGRESS')
    expect(res.body.lease_owner).toBe('my-agent')
    expect(res.body.lease_expires_at).toBeDefined()
  })

  it('POST /tasks/claim-next uses configured lease_ttl_ms', async () => {
    const customApp = createTestApp(deps, { lease_ttl_ms: 30000 })
    const task = taskStore.create(makeTaskInput())

    const before = Date.now()
    const res = await request(customApp)
      .post('/tasks/claim-next')
      .send({ lease_owner: 'my-agent' })
      .expect(200)
    const after = Date.now()

    expect(res.body.id).toBe(task.id)
    const leaseTime = new Date(res.body.lease_expires_at).getTime()
    expect(leaseTime).toBeGreaterThanOrEqual(before + 30000)
    expect(leaseTime).toBeLessThanOrEqual(after + 30000)
  })

  // 14. POST /tasks/claim-next returns 404 when empty
  it('POST /tasks/claim-next returns 404 when no pending tasks', async () => {
    const res = await request(app)
      .post('/tasks/claim-next')
      .send({ lease_owner: 'my-agent' })
      .expect(404)

    expect(res.body).toHaveProperty('error')
  })

  // 15. GET /audit returns audit log
  it('GET /audit returns audit log', async () => {
    const task = taskStore.create(makeTaskInput())
    auditLog.logAction({
      task_id: task.id,
      action: 'created',
      actor: 'test',
    })

    const res = await request(app)
      .get('/audit')
      .expect(200)

    expect(Array.isArray(res.body)).toBe(true)
    expect(res.body.length).toBeGreaterThanOrEqual(1)
    expect(res.body[0]).toHaveProperty('task_id', task.id)
  })

  // 16. GET /health returns counts
  it('GET /health returns counts', async () => {
    taskStore.create(makeTaskInput())
    taskStore.create(makeTaskInput())

    const res = await request(app)
      .get('/health')
      .expect(200)

    expect(res.body).toHaveProperty('status', 'ok')
    expect(res.body).toHaveProperty('counts')
    expect(res.body.counts).toHaveProperty('PENDING', 2)
    expect(res.body.counts).toHaveProperty('IN_PROGRESS', 0)
    expect(res.body.counts).toHaveProperty('REVIEW', 0)
    expect(res.body.counts).toHaveProperty('DONE', 0)
    expect(res.body.counts).toHaveProperty('BLOCKED', 0)
  })

  // 17. API key auth rejects unauthorized
  it('API key auth rejects unauthorized requests', async () => {
    const authApp = createTestApp(deps, { api_key: 'secret-key-123' })

    const res = await request(authApp)
      .get('/tasks')
      .expect(401)

    expect(res.body).toHaveProperty('error')
  })

  // 18. API key auth allows authorized
  it('API key auth allows authorized requests', async () => {
    const authApp = createTestApp(deps, { api_key: 'secret-key-123' })
    taskStore.create(makeTaskInput())

    const res = await request(authApp)
      .get('/tasks')
      .set('x-api-key', 'secret-key-123')
      .expect(200)

    expect(Array.isArray(res.body)).toBe(true)
  })
})
