import { describe, it, expect } from 'vitest'
import { VERSION } from '../src/index.js'

describe('@openskelo/gates', () => {
  it('exports version', () => {
    expect(VERSION).toBe('0.0.1')
  })
})
