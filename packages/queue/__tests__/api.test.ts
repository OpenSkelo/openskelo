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
import { TemplateStore } from '../src/templates.js'

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
  let templateStore: TemplateStore
  let priorityQueue: PriorityQueue
  let auditLog: AuditLog
  let dispatcher: Dispatcher
  let deps: ApiDependencies
  let app: ReturnType<typeof express>

  beforeEach(() => {
    db = createDatabase(':memory:')
    taskStore = new TaskStore(db)
    templateStore = new TemplateStore(db, taskStore)
    priorityQueue = new PriorityQueue(db)
    auditLog = new AuditLog(db)
    const adapter = createHangingAdapter('claude-code', ['code'])
    dispatcher = new Dispatcher(taskStore, priorityQueue, auditLog, [adapter], DEFAULT_CONFIG)
    deps = { db, taskStore, templateStore, priorityQueue, auditLog, dispatcher }
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

  // Pipeline endpoints
  it('POST /pipelines creates pipeline with correct structure', async () => {
    const res = await request(app)
      .post('/pipelines')
      .send({
        tasks: [
          { key: 'a', type: 'code', summary: 'A', prompt: 'Do A', backend: 'claude-code' },
          { key: 'b', type: 'code', summary: 'B', prompt: 'Do B', backend: 'claude-code' },
          { key: 'c', type: 'code', summary: 'C', prompt: 'Do C', backend: 'claude-code', depends_on: ['a', 'b'] },
        ],
      })
      .expect(201)

    expect(res.body).toHaveProperty('pipeline_id')
    expect(res.body.tasks).toHaveLength(3)
    // a and b are step 0, c is step 1
    const steps = res.body.tasks.map((t: Record<string, unknown>) => t.pipeline_step)
    expect(steps).toContain(0)
    expect(steps).toContain(1)
  })

  it('POST /pipelines rejects invalid DAG (cycle)', async () => {
    const res = await request(app)
      .post('/pipelines')
      .send({
        tasks: [
          { key: 'a', type: 'code', summary: 'A', prompt: 'A', backend: 'x', depends_on: ['c'] },
          { key: 'b', type: 'code', summary: 'B', prompt: 'B', backend: 'x', depends_on: ['a'] },
          { key: 'c', type: 'code', summary: 'C', prompt: 'C', backend: 'x', depends_on: ['b'] },
        ],
      })
      .expect(400)

    expect(res.body.error).toContain('Cycle')
  })

  it('POST /pipelines rejects missing depends_on reference', async () => {
    const res = await request(app)
      .post('/pipelines')
      .send({
        tasks: [
          { key: 'a', type: 'code', summary: 'A', prompt: 'A', backend: 'x', depends_on: ['missing'] },
        ],
      })
      .expect(400)

    expect(res.body.error).toContain('Unknown dependency')
  })

  it('GET /pipelines/:id returns all tasks in pipeline', async () => {
    const createRes = await request(app)
      .post('/pipelines')
      .send({
        tasks: [
          { key: 'a', type: 'code', summary: 'A', prompt: 'Do A', backend: 'claude-code' },
          { key: 'b', type: 'code', summary: 'B', prompt: 'Do B', backend: 'claude-code', depends_on: ['a'] },
        ],
      })
      .expect(201)

    const pipelineId = createRes.body.pipeline_id

    const res = await request(app)
      .get(`/pipelines/${pipelineId}`)
      .expect(200)

    expect(Array.isArray(res.body)).toBe(true)
    expect(res.body).toHaveLength(2)
    expect(res.body[0].pipeline_step).toBeLessThanOrEqual(res.body[1].pipeline_step)
  })

  it('GET /pipelines returns pipeline list', async () => {
    await request(app)
      .post('/pipelines')
      .send({
        tasks: [
          { key: 'x', type: 'code', summary: 'X', prompt: 'X', backend: 'claude-code' },
        ],
      })
      .expect(201)

    const res = await request(app)
      .get('/pipelines')
      .expect(200)

    expect(Array.isArray(res.body)).toBe(true)
    expect(res.body.length).toBeGreaterThanOrEqual(1)
    expect(res.body[0]).toHaveProperty('pipeline_id')
    expect(res.body[0]).toHaveProperty('task_count')
    expect(res.body[0]).toHaveProperty('completed')
    expect(res.body[0]).toHaveProperty('status')
  })

  it('POST /pipelines rejects > 50 nodes', async () => {
    const tasks = Array.from({ length: 51 }, (_, i) => ({
      key: `task-${i}`,
      type: 'code',
      summary: `Task ${i}`,
      prompt: `Do ${i}`,
      backend: 'claude-code',
    }))

    const res = await request(app)
      .post('/pipelines')
      .send({ tasks })
      .expect(400)

    expect(res.body.error).toContain('maximum of 50')
  })

  it('POST /pipelines rejects node with > 10 dependencies', async () => {
    const roots = Array.from({ length: 11 }, (_, i) => ({
      key: `root-${i}`,
      type: 'code',
      summary: `Root ${i}`,
      prompt: `Do ${i}`,
      backend: 'claude-code',
    }))

    const merge = {
      key: 'merge',
      type: 'code',
      summary: 'Merge',
      prompt: 'Merge all',
      backend: 'claude-code',
      depends_on: roots.map(r => r.key),
    }

    const res = await request(app)
      .post('/pipelines')
      .send({ tasks: [...roots, merge] })
      .expect(400)

    expect(res.body.error).toContain('more than 10 dependencies')
  })

  // Template endpoints
  it('POST /templates creates template', async () => {
    const res = await request(app)
      .post('/templates')
      .send({
        name: 'test-tpl',
        template_type: 'task',
        definition: { type: 'code', summary: 'Test', prompt: 'Do it', backend: 'claude-code' },
      })
      .expect(201)

    expect(res.body.name).toBe('test-tpl')
    expect(res.body.template_type).toBe('task')
    expect(res.body.id).toBeTruthy()
  })

  it('POST /templates rejects invalid template_type', async () => {
    const res = await request(app)
      .post('/templates')
      .send({
        name: 'invalid-type',
        template_type: 'weird',
        definition: { type: 'code', summary: 'X', prompt: 'X', backend: 'x' },
      })
      .expect(400)

    expect(res.body.error).toBe('template_type must be "task" or "pipeline"')
  })

  it('GET /templates lists templates', async () => {
    await request(app)
      .post('/templates')
      .send({ name: 't1', template_type: 'task', definition: { type: 'code', summary: 'X', prompt: 'X', backend: 'x' } })

    const res = await request(app)
      .get('/templates')
      .expect(200)

    expect(Array.isArray(res.body)).toBe(true)
    expect(res.body.length).toBeGreaterThanOrEqual(1)
  })

  it('GET /templates/:name returns by name', async () => {
    await request(app)
      .post('/templates')
      .send({ name: 'find-me', template_type: 'task', definition: { type: 'code', summary: 'X', prompt: 'X', backend: 'x' } })

    const res = await request(app)
      .get('/templates/find-me')
      .expect(200)

    expect(res.body.name).toBe('find-me')
  })

  it('POST /templates/:id/run instantiates and creates task(s)', async () => {
    const createRes = await request(app)
      .post('/templates')
      .send({
        name: 'run-me',
        template_type: 'task',
        definition: { type: 'code', summary: 'Run task', prompt: 'Do it', backend: 'claude-code' },
      })
      .expect(201)

    const res = await request(app)
      .post(`/templates/${createRes.body.id}/run`)
      .send({})
      .expect(201)

    expect(res.body.tasks).toHaveLength(1)
    expect(res.body.tasks[0].summary).toBe('Run task')
  })

  it('POST /templates/:id/run with variables substitutes correctly', async () => {
    await request(app)
      .post('/templates')
      .send({
        name: 'var-tpl',
        template_type: 'task',
        definition: { type: 'code', summary: 'Fix {{module}}', prompt: 'Analyze {{file}}', backend: 'claude-code' },
      })
      .expect(201)

    const res = await request(app)
      .post('/templates/var-tpl/run')
      .send({ variables: { module: 'auth', file: 'src/auth.ts' } })
      .expect(201)

    expect(res.body.tasks[0].summary).toBe('Fix auth')
    expect(res.body.tasks[0].prompt).toBe('Analyze src/auth.ts')
  })

  it('PUT /templates/:id rejects invalid template_type', async () => {
    const createRes = await request(app)
      .post('/templates')
      .send({ name: 'put-invalid', template_type: 'task', definition: { type: 'code', summary: 'X', prompt: 'X', backend: 'x' } })
      .expect(201)

    const res = await request(app)
      .put(`/templates/${createRes.body.id}`)
      .send({ template_type: 'weird' })
      .expect(400)

    expect(res.body.error).toBe('template_type must be "task" or "pipeline"')
  })

  it('DELETE /templates/:id removes template', async () => {
    const createRes = await request(app)
      .post('/templates')
      .send({ name: 'del-me', template_type: 'task', definition: { type: 'code', summary: 'X', prompt: 'X', backend: 'x' } })
      .expect(201)

    await request(app)
      .delete(`/templates/${createRes.body.id}`)
      .expect(200)

    await request(app)
      .get(`/templates/${createRes.body.id}`)
      .expect(404)
  })

  // Task injection
  it('POST /tasks with inject_before and priority_boost creates injected task', async () => {
    const target = taskStore.create(makeTaskInput({ summary: 'target task' }))

    const res = await request(app)
      .post('/tasks')
      .send({
        ...makeTaskInput({ summary: 'fix task' }),
        inject_before: target.id,
        priority_boost: -10,
      })
      .expect(201)

    expect(res.body.priority).toBe(-10)
    expect(res.body.summary).toBe('fix task')

    // Target should now depend on the injected task
    const updatedTarget = taskStore.getById(target.id)!
    expect(updatedTarget.depends_on).toContain(res.body.id)
  })

  it('POST /tasks with missing inject_before target returns 400', async () => {
    const res = await request(app)
      .post('/tasks')
      .send({
        ...makeTaskInput({ summary: 'bad inject task' }),
        inject_before: 'MISSING-TASK',
        priority_boost: -10,
      })
      .expect(400)

    expect(res.body.error).toContain('inject_before target task not found')
  })

  // Schedule endpoint
  it('GET /schedules returns empty array when no scheduler', async () => {
    const res = await request(app)
      .get('/schedules')
      .expect(200)

    expect(Array.isArray(res.body)).toBe(true)
  })
})
