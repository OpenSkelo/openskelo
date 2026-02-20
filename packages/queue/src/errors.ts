export class TransitionError extends Error {
  readonly from: string
  readonly to: string
  readonly reason: string

  constructor(from: string, to: string, reason: string) {
    super(`Invalid transition ${from} → ${to}: ${reason}`)
    this.name = 'TransitionError'
    this.from = from
    this.to = to
    this.reason = reason
  }
}

export class LeaseExpiredError extends Error {
  readonly taskId: string
  readonly expiredAt: string

  constructor(taskId: string, expiredAt: string) {
    super(`Lease expired for task ${taskId} at ${expiredAt}`)
    this.name = 'LeaseExpiredError'
    this.taskId = taskId
    this.expiredAt = expiredAt
  }
}

export class DependencyError extends Error {
  readonly taskId: string
  readonly blockedBy: string[]

  constructor(taskId: string, blockedBy: string[]) {
    super(`Task ${taskId} blocked by: ${blockedBy.join(', ')}`)
    this.name = 'DependencyError'
    this.taskId = taskId
    this.blockedBy = blockedBy
  }
}

export class WipLimitError extends Error {
  readonly taskType: string
  readonly current: number
  readonly limit: number

  constructor(taskType: string, current: number, limit: number) {
    super(`WIP limit reached for ${taskType}: ${current}/${limit}`)
    this.name = 'WipLimitError'
    this.taskType = taskType
    this.current = current
    this.limit = limit
  }
}
