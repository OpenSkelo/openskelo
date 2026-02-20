import { TransitionError } from './errors.js'

export enum TaskStatus {
  PENDING = 'PENDING',
  IN_PROGRESS = 'IN_PROGRESS',
  REVIEW = 'REVIEW',
  DONE = 'DONE',
  BLOCKED = 'BLOCKED',
}

export interface TransitionContext {
  lease_owner?: string
  result?: string
  evidence_ref?: string
  feedback?: { what: string; where: string; fix: string }
  attempt_count?: number
  max_attempts?: number
  bounce_count?: number
  max_bounces?: number
  last_error?: string
  reason?: string
}

interface TaskState {
  status: TaskStatus
  attempt_count?: number
  max_attempts?: number
  bounce_count?: number
  max_bounces?: number
}

// Valid transitions map: from → [possible targets]
const VALID_TRANSITIONS: Record<TaskStatus, TaskStatus[]> = {
  [TaskStatus.PENDING]: [TaskStatus.IN_PROGRESS, TaskStatus.BLOCKED],
  [TaskStatus.IN_PROGRESS]: [TaskStatus.REVIEW, TaskStatus.PENDING, TaskStatus.BLOCKED],
  [TaskStatus.REVIEW]: [TaskStatus.DONE, TaskStatus.PENDING, TaskStatus.BLOCKED],
  [TaskStatus.DONE]: [],
  [TaskStatus.BLOCKED]: [TaskStatus.PENDING],
}

export function getValidTransitions(from: TaskStatus): TaskStatus[] {
  return VALID_TRANSITIONS[from] ?? []
}

export function canTransition(
  from: TaskStatus,
  to: TaskStatus,
  context?: TransitionContext,
): boolean {
  try {
    validateTransition(from, to, context)
    return true
  } catch {
    return false
  }
}

export function validateTransition(
  from: TaskStatus,
  to: TaskStatus,
  context?: TransitionContext,
): void {
  const valid = VALID_TRANSITIONS[from]
  if (!valid?.includes(to)) {
    throw new TransitionError(from, to, `transition ${from} → ${to} is not allowed`)
  }

  // Guard checks for specific transitions
  if (from === TaskStatus.PENDING && to === TaskStatus.IN_PROGRESS) {
    if (!context?.lease_owner) {
      throw new TransitionError(from, to, 'lease_owner is required')
    }
  }

  if (from === TaskStatus.IN_PROGRESS && to === TaskStatus.REVIEW) {
    if (!context?.result && !context?.evidence_ref) {
      throw new TransitionError(from, to, 'result or evidence_ref is required')
    }
  }

  if (from === TaskStatus.REVIEW && to === TaskStatus.PENDING) {
    if (!context?.feedback) {
      throw new TransitionError(from, to, 'feedback is required for bounce')
    }
    const bounceCount = context.bounce_count ?? 0
    const maxBounces = context.max_bounces ?? 3
    if (bounceCount >= maxBounces) {
      throw new TransitionError(from, to, `bounce limit reached (${bounceCount}/${maxBounces})`)
    }
  }

  if (from === TaskStatus.IN_PROGRESS && to === TaskStatus.PENDING) {
    const attemptCount = context?.attempt_count ?? 0
    const maxAttempts = context?.max_attempts ?? 5
    if (attemptCount >= maxAttempts) {
      throw new TransitionError(from, to, `attempt limit reached (${attemptCount}/${maxAttempts})`)
    }
  }
}

export function applyTransition(
  task: TaskState,
  to: TaskStatus,
  context: TransitionContext,
): Record<string, unknown> {
  const updates: Record<string, unknown> = {
    status: to,
    updated_at: new Date().toISOString(),
  }

  // REVIEW → PENDING: increment bounce_count
  if (task.status === TaskStatus.REVIEW && to === TaskStatus.PENDING) {
    updates.bounce_count = (task.bounce_count ?? 0) + 1
    updates.lease_owner = null
    updates.lease_expires_at = null
  }

  // IN_PROGRESS → PENDING: increment attempt_count, clear lease
  if (task.status === TaskStatus.IN_PROGRESS && to === TaskStatus.PENDING) {
    updates.attempt_count = (task.attempt_count ?? 0) + 1
    updates.lease_owner = null
    updates.lease_expires_at = null
    if (context.last_error) {
      updates.last_error = context.last_error
    }
  }

  // IN_PROGRESS → REVIEW: clear lease
  if (task.status === TaskStatus.IN_PROGRESS && to === TaskStatus.REVIEW) {
    updates.lease_owner = null
    updates.lease_expires_at = null
    if (context.result) updates.result = context.result
    if (context.evidence_ref) updates.evidence_ref = context.evidence_ref
  }

  // IN_PROGRESS → BLOCKED: clear lease
  if (task.status === TaskStatus.IN_PROGRESS && to === TaskStatus.BLOCKED) {
    updates.lease_owner = null
    updates.lease_expires_at = null
    if (context.last_error) updates.last_error = context.last_error
  }

  // Any → BLOCKED: store reason
  if (to === TaskStatus.BLOCKED && context.reason) {
    updates.last_error = context.reason
  }

  return updates
}
