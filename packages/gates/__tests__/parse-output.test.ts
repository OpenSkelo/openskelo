import { describe, expect, it } from 'vitest'
import { parseOutput } from '../src/utils/parse-output.js'

describe('parse-output utility', () => {
  it('parses clean JSON string', () => {
    expect(parseOutput('{"a":1}')).toEqual({ a: 1 })
  })

  it('parses fenced JSON block', () => {
    const raw = '```json\n{"a":1}\n```'
    expect(parseOutput(raw)).toEqual({ a: 1 })
  })

  it('parses JSON with preamble text', () => {
    const raw = 'Here is output:\n{"a":1,"b":2}'
    expect(parseOutput(raw)).toEqual({ a: 1, b: 2 })
  })

  it('parses nested objects', () => {
    const raw = '{"user":{"profile":{"name":"Nora"}}}'
    expect(parseOutput(raw)).toEqual({ user: { profile: { name: 'Nora' } } })
  })

  it('parses nested arrays and objects', () => {
    const raw = '{"items":[{"id":1},{"id":2}]}'
    expect(parseOutput(raw)).toEqual({ items: [{ id: 1 }, { id: 2 }] })
  })

  it('parses first valid JSON from double fenced blocks', () => {
    const raw = '```json\n{"x":1}\n```\n```json\n{"x":2}\n```'
    expect(parseOutput(raw)).toEqual({ x: 1 })
  })

  it('throws when no JSON found', () => {
    expect(() => parseOutput('plain text only')).toThrow('No JSON found')
  })

  it('throws for invalid balanced JSON', () => {
    expect(() => parseOutput('prefix {"a":1,} suffix')).toThrow('Invalid JSON found')
  })

  it('parses JSON array payload', () => {
    expect(parseOutput('[1,2,3]')).toEqual([1, 2, 3])
  })

  it('handles escaped braces in strings', () => {
    const raw = '{"text":"{not-json}","ok":true}'
    expect(parseOutput(raw)).toEqual({ text: '{not-json}', ok: true })
  })
})
