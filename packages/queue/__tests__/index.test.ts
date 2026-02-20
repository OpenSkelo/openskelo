import { describe, it, expect } from 'vitest'
import { VERSION } from '../src/index.js'

describe('@openskelo/queue', () => {
  it('exports version', () => {
    expect(VERSION).toBe('0.0.1')
  })
})
