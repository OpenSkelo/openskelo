import { describe, it, expect } from 'vitest'
import {
  TaskStatus,
  canTransition,
  validateTransition,
  getValidTransitions,
  applyTransition,
} from '../src/state-machine.js'
import { TransitionError } from '../src/errors.js'

describe('State Machine', () => {
  describe('valid transitions', () => {
    it('PENDING → IN_PROGRESS with lease_owner', () => {
      expect(canTransition(TaskStatus.PENDING, TaskStatus.IN_PROGRESS, { lease_owner: 'adapter-1' })).toBe(true)
    })

    it('IN_PROGRESS → REVIEW with result', () => {
      expect(canTransition(TaskStatus.IN_PROGRESS, TaskStatus.REVIEW, { result: 'output' })).toBe(true)
    })

    it('IN_PROGRESS → REVIEW with evidence_ref', () => {
      expect(canTransition(TaskStatus.IN_PROGRESS, TaskStatus.REVIEW, { evidence_ref: 'diff://abc' })).toBe(true)
    })

    it('REVIEW → DONE (approve)', () => {
      expect(canTransition(TaskStatus.REVIEW, TaskStatus.DONE)).toBe(true)
    })

    it('REVIEW → PENDING with feedback (bounce)', () => {
      expect(canTransition(TaskStatus.REVIEW, TaskStatus.PENDING, {
        feedback: { what: 'bad', where: 'here', fix: 'this' },
        bounce_count: 0,
        max_bounces: 3,
      })).toBe(true)
    })

    it('IN_PROGRESS → PENDING (timeout/release)', () => {
      expect(canTransition(TaskStatus.IN_PROGRESS, TaskStatus.PENDING, {
        attempt_count: 1,
        max_attempts: 5,
      })).toBe(true)
    })

    it('IN_PROGRESS → BLOCKED (gate exhaustion)', () => {
      expect(canTransition(TaskStatus.IN_PROGRESS, TaskStatus.BLOCKED)).toBe(true)
    })

    it('Any → BLOCKED (manual cancel)', () => {
      expect(canTransition(TaskStatus.PENDING, TaskStatus.BLOCKED)).toBe(true)
      expect(canTransition(TaskStatus.REVIEW, TaskStatus.BLOCKED)).toBe(true)
    })
  })

  describe('invalid transitions', () => {
    it('PENDING → DONE throws', () => {
      expect(() => validateTransition(TaskStatus.PENDING, TaskStatus.DONE)).toThrow(TransitionError)
    })

    it('PENDING → REVIEW throws', () => {
      expect(() => validateTransition(TaskStatus.PENDING, TaskStatus.REVIEW)).toThrow(TransitionError)
    })

    it('DONE → PENDING throws', () => {
      expect(() => validateTransition(TaskStatus.DONE, TaskStatus.PENDING)).toThrow(TransitionError)
    })

    it('DONE → IN_PROGRESS throws', () => {
      expect(() => validateTransition(TaskStatus.DONE, TaskStatus.IN_PROGRESS)).toThrow(TransitionError)
    })

    it('DONE → REVIEW throws', () => {
      expect(() => validateTransition(TaskStatus.DONE, TaskStatus.REVIEW)).toThrow(TransitionError)
    })

    it('DONE → BLOCKED throws', () => {
      expect(() => validateTransition(TaskStatus.DONE, TaskStatus.BLOCKED)).toThrow(TransitionError)
    })

    it('BLOCKED → IN_PROGRESS throws', () => {
      expect(() => validateTransition(TaskStatus.BLOCKED, TaskStatus.IN_PROGRESS)).toThrow(TransitionError)
    })

    it('REVIEW → IN_PROGRESS throws', () => {
      expect(() => validateTransition(TaskStatus.REVIEW, TaskStatus.IN_PROGRESS)).toThrow(TransitionError)
    })
  })

  describe('guard checks', () => {
    it('PENDING → IN_PROGRESS without lease_owner fails', () => {
      expect(canTransition(TaskStatus.PENDING, TaskStatus.IN_PROGRESS)).toBe(false)
      expect(() => validateTransition(TaskStatus.PENDING, TaskStatus.IN_PROGRESS)).toThrow('lease_owner')
    })

    it('IN_PROGRESS → REVIEW without result or evidence_ref fails', () => {
      expect(canTransition(TaskStatus.IN_PROGRESS, TaskStatus.REVIEW)).toBe(false)
      expect(() => validateTransition(TaskStatus.IN_PROGRESS, TaskStatus.REVIEW)).toThrow('result')
    })

    it('REVIEW → PENDING without feedback fails', () => {
      expect(canTransition(TaskStatus.REVIEW, TaskStatus.PENDING)).toBe(false)
      expect(() => validateTransition(TaskStatus.REVIEW, TaskStatus.PENDING)).toThrow('feedback')
    })

    it('REVIEW → PENDING fails when bounce_count >= max_bounces', () => {
      expect(canTransition(TaskStatus.REVIEW, TaskStatus.PENDING, {
        feedback: { what: 'bad', where: 'here', fix: 'this' },
        bounce_count: 3,
        max_bounces: 3,
      })).toBe(false)
    })

    it('IN_PROGRESS → PENDING fails when attempt_count >= max_attempts', () => {
      expect(canTransition(TaskStatus.IN_PROGRESS, TaskStatus.PENDING, {
        attempt_count: 5,
        max_attempts: 5,
      })).toBe(false)
    })
  })

  describe('getValidTransitions', () => {
    it('returns correct list for PENDING', () => {
      const result = getValidTransitions(TaskStatus.PENDING)
      expect(result).toContain(TaskStatus.IN_PROGRESS)
      expect(result).toContain(TaskStatus.BLOCKED)
      expect(result).not.toContain(TaskStatus.DONE)
      expect(result).not.toContain(TaskStatus.REVIEW)
    })

    it('returns correct list for IN_PROGRESS', () => {
      const result = getValidTransitions(TaskStatus.IN_PROGRESS)
      expect(result).toContain(TaskStatus.REVIEW)
      expect(result).toContain(TaskStatus.PENDING)
      expect(result).toContain(TaskStatus.BLOCKED)
    })

    it('returns correct list for REVIEW', () => {
      const result = getValidTransitions(TaskStatus.REVIEW)
      expect(result).toContain(TaskStatus.DONE)
      expect(result).toContain(TaskStatus.PENDING)
      expect(result).toContain(TaskStatus.BLOCKED)
    })

    it('returns empty list for DONE', () => {
      expect(getValidTransitions(TaskStatus.DONE)).toEqual([])
    })

    it('returns PENDING for BLOCKED', () => {
      const result = getValidTransitions(TaskStatus.BLOCKED)
      expect(result).toContain(TaskStatus.PENDING)
    })
  })

  describe('applyTransition', () => {
    it('increments bounce_count on REVIEW → PENDING', () => {
      const updates = applyTransition(
        { status: TaskStatus.REVIEW, bounce_count: 1, max_bounces: 3 },
        TaskStatus.PENDING,
        { feedback: { what: 'bad', where: 'here', fix: 'this' } },
      )
      expect(updates.bounce_count).toBe(2)
      expect(updates.status).toBe(TaskStatus.PENDING)
    })

    it('increments attempt_count on IN_PROGRESS → PENDING', () => {
      const updates = applyTransition(
        { status: TaskStatus.IN_PROGRESS, attempt_count: 2, max_attempts: 5 },
        TaskStatus.PENDING,
        {},
      )
      expect(updates.attempt_count).toBe(3)
      expect(updates.status).toBe(TaskStatus.PENDING)
    })

    it('clears lease on IN_PROGRESS → REVIEW', () => {
      const updates = applyTransition(
        { status: TaskStatus.IN_PROGRESS, attempt_count: 0, max_attempts: 5 },
        TaskStatus.REVIEW,
        { result: 'done' },
      )
      expect(updates.lease_owner).toBeNull()
      expect(updates.lease_expires_at).toBeNull()
    })

    it('clears lease on IN_PROGRESS → PENDING', () => {
      const updates = applyTransition(
        { status: TaskStatus.IN_PROGRESS, attempt_count: 0, max_attempts: 5 },
        TaskStatus.PENDING,
        {},
      )
      expect(updates.lease_owner).toBeNull()
      expect(updates.lease_expires_at).toBeNull()
    })
  })
})
