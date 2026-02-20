import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { createDatabase } from '../src/db.js'
import { AuditLog } from '../src/audit.js'
import type { AuditEntry } from '../src/audit.js'
import type Database from 'better-sqlite3'

describe('AuditLog', () => {
  let db: Database.Database
  let audit: AuditLog

  beforeEach(() => {
    db = createDatabase(':memory:')
    audit = new AuditLog(db)
  })

  afterEach(() => {
    db.close()
  })

  it('logAction creates entry with ULID', () => {
    const entry = audit.logAction({
      task_id: 'TASK-1',
      action: 'create',
    })
    expect(entry.id).toMatch(/^[0-9A-Z]{26}$/)
    expect(entry.task_id).toBe('TASK-1')
    expect(entry.action).toBe('create')
  })

  it('logAction stores all fields', () => {
    const entry = audit.logAction({
      task_id: 'TASK-1',
      action: 'transition',
      actor: 'dispatcher',
      before_state: 'PENDING',
      after_state: 'IN_PROGRESS',
      metadata: { reason: 'claimed by adapter' },
    })
    expect(entry.actor).toBe('dispatcher')
    expect(entry.before_state).toBe('PENDING')
    expect(entry.after_state).toBe('IN_PROGRESS')
    expect(entry.metadata).toEqual({ reason: 'claimed by adapter' })
    expect(entry.created_at).toBeDefined()
  })

  it('getLog returns chronological order', () => {
    audit.logAction({ task_id: 'T1', action: 'create' })
    audit.logAction({ task_id: 'T2', action: 'create' })
    audit.logAction({ task_id: 'T3', action: 'create' })

    const log = audit.getLog()
    expect(log).toHaveLength(3)
    // Chronological: first created should be first
    expect(log[0].task_id).toBe('T1')
    expect(log[2].task_id).toBe('T3')
  })

  it('getLog filters by task_id', () => {
    audit.logAction({ task_id: 'T1', action: 'create' })
    audit.logAction({ task_id: 'T2', action: 'create' })
    audit.logAction({ task_id: 'T1', action: 'transition' })

    const log = audit.getLog({ task_id: 'T1' })
    expect(log).toHaveLength(2)
    expect(log.every(e => e.task_id === 'T1')).toBe(true)
  })

  it('getLog supports limit and offset', () => {
    for (let i = 0; i < 10; i++) {
      audit.logAction({ task_id: `T${i}`, action: 'create' })
    }
    expect(audit.getLog({ limit: 3 })).toHaveLength(3)
    expect(audit.getLog({ limit: 3, offset: 8 })).toHaveLength(2)
  })

  it('getTaskHistory returns only entries for specified task', () => {
    audit.logAction({ task_id: 'T1', action: 'create' })
    audit.logAction({ task_id: 'T2', action: 'create' })
    audit.logAction({ task_id: 'T1', action: 'claim' })

    const history = audit.getTaskHistory('T1')
    expect(history).toHaveLength(2)
    expect(history[0].action).toBe('create')
    expect(history[1].action).toBe('claim')
  })

  it('multiple actions for same task ordered correctly', () => {
    audit.logAction({ task_id: 'T1', action: 'create' })
    audit.logAction({ task_id: 'T1', action: 'claim' })
    audit.logAction({ task_id: 'T1', action: 'transition' })

    const history = audit.getTaskHistory('T1')
    expect(history.map(e => e.action)).toEqual(['create', 'claim', 'transition'])
  })

  it('serializes metadata as JSON', () => {
    const meta = { key: 'value', nested: { deep: true } }
    const entry = audit.logAction({
      task_id: 'T1',
      action: 'test',
      metadata: meta,
    })
    expect(entry.metadata).toEqual(meta)

    const fetched = audit.getTaskHistory('T1')
    expect(fetched[0].metadata).toEqual(meta)
  })
})
