import { describe, expect, it } from 'vitest'
import { evaluateExpressionGate } from '../src/gates/expression.js'
import { safeEval } from '../src/utils/safe-eval.js'

describe('expression gate + safe-eval', () => {
  it('evaluates arithmetic addition', () => {
    const result = evaluateExpressionGate({ type: 'expression', expr: 'data.a + data.b === 5' }, { a: 2, b: 3 })
    expect(result.passed).toBe(true)
  })

  it('evaluates subtraction', () => {
    const result = evaluateExpressionGate({ type: 'expression', expr: 'data.a - data.b === 1' }, { a: 4, b: 3 })
    expect(result.passed).toBe(true)
  })

  it('evaluates multiplication', () => {
    const result = evaluateExpressionGate({ type: 'expression', expr: 'data.a * data.b === 12' }, { a: 3, b: 4 })
    expect(result.passed).toBe(true)
  })

  it('evaluates division', () => {
    const result = evaluateExpressionGate({ type: 'expression', expr: 'data.a / data.b === 2' }, { a: 6, b: 3 })
    expect(result.passed).toBe(true)
  })

  it('evaluates modulo', () => {
    const result = evaluateExpressionGate({ type: 'expression', expr: 'data.a % 2 === 1' }, { a: 7 })
    expect(result.passed).toBe(true)
  })

  it('evaluates comparison operators', () => {
    const result = evaluateExpressionGate({ type: 'expression', expr: 'data.a >= 5 && data.a <= 10' }, { a: 8 })
    expect(result.passed).toBe(true)
  })

  it('evaluates logical operators', () => {
    const result = evaluateExpressionGate({ type: 'expression', expr: 'data.a === 1 || data.b === 2' }, { a: 0, b: 2 })
    expect(result.passed).toBe(true)
  })

  it('evaluates negation', () => {
    const result = evaluateExpressionGate({ type: 'expression', expr: '!(data.a === 2)' }, { a: 3 })
    expect(result.passed).toBe(true)
  })

  it('supports nested property access', () => {
    const result = evaluateExpressionGate({ type: 'expression', expr: 'data.user.profile.age === 30' }, { user: { profile: { age: 30 } } })
    expect(result.passed).toBe(true)
  })

  it('supports array length', () => {
    const result = evaluateExpressionGate({ type: 'expression', expr: 'data.items.length === 3' }, { items: [1, 2, 3] })
    expect(result.passed).toBe(true)
  })

  it('supports string equality', () => {
    const result = evaluateExpressionGate({ type: 'expression', expr: "data.msg === 'hello'" }, { msg: 'hello' })
    expect(result.passed).toBe(true)
  })

  it('supports string methods', () => {
    const result = evaluateExpressionGate({ type: 'expression', expr: "data.msg.toLowerCase() === 'hello'" }, { msg: 'HELLO' })
    expect(result.passed).toBe(true)
  })

  it('returns false when expression evaluates false', () => {
    const result = evaluateExpressionGate({ type: 'expression', expr: 'data.score > 90' }, { score: 80 })
    expect(result.passed).toBe(false)
  })

  it('blocks process access', () => {
    const result = evaluateExpressionGate({ type: 'expression', expr: 'process.env' }, {})
    expect(result.passed).toBe(false)
  })

  it('blocks require access', () => {
    const result = evaluateExpressionGate({ type: 'expression', expr: "require('fs')" }, {})
    expect(result.passed).toBe(false)
  })

  it('blocks import keyword usage', () => {
    const result = evaluateExpressionGate({ type: 'expression', expr: 'import.meta' }, {})
    expect(result.passed).toBe(false)
  })

  it('blocks eval usage', () => {
    const result = evaluateExpressionGate({ type: 'expression', expr: "eval('1+1')" }, {})
    expect(result.passed).toBe(false)
  })

  it('blocks Function usage', () => {
    const result = evaluateExpressionGate({ type: 'expression', expr: "Function('return 1')()" }, {})
    expect(result.passed).toBe(false)
  })

  it('blocks fetch usage', () => {
    const result = evaluateExpressionGate({ type: 'expression', expr: "fetch('https://x')" }, {})
    expect(result.passed).toBe(false)
  })

  it('blocks constructor access', () => {
    const result = evaluateExpressionGate({ type: 'expression', expr: 'data.constructor' }, { a: 1 })
    expect(result.passed).toBe(false)
  })

  it('blocks __proto__ access', () => {
    const result = evaluateExpressionGate({ type: 'expression', expr: 'data.__proto__' }, { a: 1 })
    expect(result.passed).toBe(false)
  })

  it('blocks prototype access', () => {
    const result = evaluateExpressionGate({ type: 'expression', expr: 'data.prototype' }, { a: 1 })
    expect(result.passed).toBe(false)
  })

  it('blocks disallowed method calls', () => {
    expect(() => safeEval('data.msg.charCodeAt(0)', { data: { msg: 'x' } })).toThrow('Method not allowed')
  })

  it('blocks unsupported syntax with new', () => {
    expect(() => safeEval('new Date()', {})).toThrow('Unsupported syntax')
  })

  it('blocks unsupported operators', () => {
    expect(() => safeEval('data.a ?? 1', { data: { a: 1 } })).toThrow('Unsupported syntax')
  })
})
