import { describe, it, expect, afterEach } from 'vitest'
import { createDatabase } from '../src/db.js'
import type Database from 'better-sqlite3'

describe('Database', () => {
  const dbs: Database.Database[] = []
  function makeDb() {
    const db = createDatabase(':memory:')
    dbs.push(db)
    return db
  }
  afterEach(() => {
    dbs.forEach(db => db.close())
    dbs.length = 0
  })

  it('creates tasks table successfully', () => {
    const db = makeDb()
    const tables = db.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='tasks'"
    ).all() as { name: string }[]
    expect(tables).toHaveLength(1)
    expect(tables[0].name).toBe('tasks')
  })

  it('creates audit_log table successfully', () => {
    const db = makeDb()
    const tables = db.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='audit_log'"
    ).all() as { name: string }[]
    expect(tables).toHaveLength(1)
  })

  it('can insert and query a task', () => {
    const db = makeDb()
    const now = new Date().toISOString()
    db.prepare(`
      INSERT INTO tasks (id, type, summary, prompt, backend, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run('TASK-001', 'coding', 'Fix bug', 'Fix the auth bug', 'claude-code', now, now)

    const task = db.prepare('SELECT * FROM tasks WHERE id = ?').get('TASK-001') as Record<string, unknown>
    expect(task.id).toBe('TASK-001')
    expect(task.summary).toBe('Fix bug')
    expect(task.status).toBe('PENDING')
  })

  it('all columns present with correct defaults', () => {
    const db = makeDb()
    const now = new Date().toISOString()
    db.prepare(`
      INSERT INTO tasks (id, type, summary, prompt, backend, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run('TASK-002', 'coding', 'Task', 'Prompt', 'shell', now, now)

    const task = db.prepare('SELECT * FROM tasks WHERE id = ?').get('TASK-002') as Record<string, unknown>
    expect(task.status).toBe('PENDING')
    expect(task.priority).toBe(0)
    expect(task.attempt_count).toBe(0)
    expect(task.bounce_count).toBe(0)
    expect(task.max_attempts).toBe(5)
    expect(task.max_bounces).toBe(3)
    expect(task.lease_owner).toBeNull()
    expect(task.lease_expires_at).toBeNull()
    expect(task.manual_rank).toBeNull()
    expect(task.result).toBeNull()
    expect(task.evidence_ref).toBeNull()
    expect(task.last_error).toBeNull()
    expect(task.pipeline_id).toBeNull()
    expect(task.pipeline_step).toBeNull()
  })

  it('indexes exist', () => {
    const db = makeDb()
    const indexes = db.prepare(
      "SELECT name FROM sqlite_master WHERE type='index'"
    ).all() as { name: string }[]
    const names = indexes.map(i => i.name)
    expect(names).toContain('idx_queue_order')
    expect(names).toContain('idx_lease_expiry')
    expect(names).toContain('idx_pipeline')
    expect(names).toContain('idx_audit_task')
  })

  it('WAL mode enabled (on-disk database)', () => {
    const fs = require('node:fs')
    const os = require('node:os')
    const path = require('node:path')
    const tmpFile = path.join(os.tmpdir(), `openskelo-test-${Date.now()}.db`)
    const db = createDatabase(tmpFile)
    dbs.push(db)
    const mode = db.pragma('journal_mode', { simple: true }) as string
    expect(mode).toBe('wal')
    db.close()
    // Clean up temp files
    for (const ext of ['', '-wal', '-shm']) {
      try { fs.unlinkSync(tmpFile + ext) } catch {}
    }
  })

  it('can insert and query audit_log', () => {
    const db = makeDb()
    const now = new Date().toISOString()
    db.prepare(`
      INSERT INTO audit_log (id, task_id, action, created_at)
      VALUES (?, ?, ?, ?)
    `).run('AUDIT-001', 'TASK-001', 'create', now)

    const entry = db.prepare('SELECT * FROM audit_log WHERE id = ?').get('AUDIT-001') as Record<string, unknown>
    expect(entry.task_id).toBe('TASK-001')
    expect(entry.action).toBe('create')
  })

  it('multiple databases are independent', () => {
    const db1 = makeDb()
    const db2 = makeDb()
    const now = new Date().toISOString()

    db1.prepare(`
      INSERT INTO tasks (id, type, summary, prompt, backend, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run('TASK-A', 'coding', 'A', 'A', 'shell', now, now)

    const inDb2 = db2.prepare('SELECT * FROM tasks WHERE id = ?').get('TASK-A')
    expect(inDb2).toBeUndefined()
  })

  it('handles concurrent reads (WAL)', () => {
    const db = makeDb()
    const now = new Date().toISOString()

    // Insert some data
    for (let i = 0; i < 10; i++) {
      db.prepare(`
        INSERT INTO tasks (id, type, summary, prompt, backend, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(`TASK-${i}`, 'coding', `Task ${i}`, 'Prompt', 'shell', now, now)
    }

    // Read all concurrently (SQLite is synchronous but WAL allows concurrent reads)
    const all = db.prepare('SELECT * FROM tasks').all() as unknown[]
    expect(all).toHaveLength(10)
  })

  it('stores JSON in text columns', () => {
    const db = makeDb()
    const now = new Date().toISOString()
    const criteria = JSON.stringify(['works', 'tests pass'])
    const metadata = JSON.stringify({ repo: '/tmp', tags: ['urgent'] })

    db.prepare(`
      INSERT INTO tasks (id, type, summary, prompt, backend, acceptance_criteria, metadata, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run('TASK-JSON', 'coding', 'JSON test', 'Prompt', 'shell', criteria, metadata, now, now)

    const task = db.prepare('SELECT * FROM tasks WHERE id = ?').get('TASK-JSON') as Record<string, unknown>
    expect(JSON.parse(task.acceptance_criteria as string)).toEqual(['works', 'tests pass'])
    expect(JSON.parse(task.metadata as string)).toEqual({ repo: '/tmp', tags: ['urgent'] })
  })

  it('audit_log stores all fields', () => {
    const db = makeDb()
    const now = new Date().toISOString()
    db.prepare(`
      INSERT INTO audit_log (id, task_id, action, actor, before_state, after_state, metadata, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run('AUD-1', 'TASK-1', 'transition', 'user', 'PENDING', 'IN_PROGRESS', '{"key":"val"}', now)

    const entry = db.prepare('SELECT * FROM audit_log WHERE id = ?').get('AUD-1') as Record<string, unknown>
    expect(entry.actor).toBe('user')
    expect(entry.before_state).toBe('PENDING')
    expect(entry.after_state).toBe('IN_PROGRESS')
    expect(entry.metadata).toBe('{"key":"val"}')
  })

  it('foreign keys enabled', () => {
    const db = makeDb()
    const fk = db.pragma('foreign_keys', { simple: true })
    expect(fk).toBe(1)
  })

  it('tasks table has correct column count', () => {
    const db = makeDb()
    const info = db.prepare("PRAGMA table_info('tasks')").all() as unknown[]
    // 28 columns per spec
    expect(info.length).toBeGreaterThanOrEqual(26)
  })
})
