import type { AttemptRecord, GateResult } from './types.js'

export class GateFailureError extends Error {
  gate: GateResult

  constructor(message: string, gate: GateResult) {
    super(message)
    this.name = 'GateFailureError'
    this.gate = gate
  }
}

export class GateExhaustionError extends Error {
  history: AttemptRecord[]

  constructor(message: string, history: AttemptRecord[]) {
    super(message)
    this.name = 'GateExhaustionError'
    this.history = history
  }
}
