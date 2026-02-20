import { z } from 'zod'
import { describe, expect, it } from 'vitest'
import { evaluateJsonSchemaGate } from '../src/gates/json-schema.js'

describe('json_schema gate', () => {
  it('passes when required fields are present', () => {
    const result = evaluateJsonSchemaGate({
      type: 'json_schema',
      schema: { type: 'object', required: ['name'] }
    }, { name: 'nora' })

    expect(result.passed).toBe(true)
  })

  it('fails when required field is missing', () => {
    const result = evaluateJsonSchemaGate({
      type: 'json_schema',
      schema: { type: 'object', required: ['name'] }
    }, {})

    expect(result.passed).toBe(false)
    expect(result.reason).toContain('name')
  })

  it('passes nested object validation', () => {
    const result = evaluateJsonSchemaGate({
      type: 'json_schema',
      schema: {
        type: 'object',
        properties: {
          user: {
            type: 'object',
            required: ['email']
          }
        }
      }
    }, { user: { email: 'a@b.com' } })

    expect(result.passed).toBe(true)
  })

  it('fails nested object when required key missing', () => {
    const result = evaluateJsonSchemaGate({
      type: 'json_schema',
      schema: {
        type: 'object',
        properties: {
          user: {
            type: 'object',
            required: ['email']
          }
        }
      }
    }, { user: {} })

    expect(result.passed).toBe(false)
    expect(JSON.stringify(result.details)).toContain('user.email')
  })

  it('passes array validation', () => {
    const result = evaluateJsonSchemaGate({
      type: 'json_schema',
      schema: { type: 'array', items: { type: 'number' } }
    }, [1, 2, 3])

    expect(result.passed).toBe(true)
  })

  it('fails array when item type mismatches', () => {
    const result = evaluateJsonSchemaGate({
      type: 'json_schema',
      schema: { type: 'array', items: { type: 'number' } }
    }, [1, '2'])

    expect(result.passed).toBe(false)
    expect(JSON.stringify(result.details)).toContain('1')
  })

  it('fails when root type mismatches', () => {
    const result = evaluateJsonSchemaGate({
      type: 'json_schema',
      schema: { type: 'object' }
    }, 'hello')

    expect(result.passed).toBe(false)
  })

  it('passes simple string type', () => {
    const result = evaluateJsonSchemaGate({
      type: 'json_schema',
      schema: { type: 'string' }
    }, 'hello')

    expect(result.passed).toBe(true)
  })

  it('fails simple string type', () => {
    const result = evaluateJsonSchemaGate({
      type: 'json_schema',
      schema: { type: 'string' }
    }, 9)

    expect(result.passed).toBe(false)
  })

  it('passes boolean type', () => {
    const result = evaluateJsonSchemaGate({
      type: 'json_schema',
      schema: { type: 'boolean' }
    }, true)

    expect(result.passed).toBe(true)
  })

  it('passes number type', () => {
    const result = evaluateJsonSchemaGate({
      type: 'json_schema',
      schema: { type: 'number' }
    }, 42)

    expect(result.passed).toBe(true)
  })

  it('passes null type', () => {
    const result = evaluateJsonSchemaGate({
      type: 'json_schema',
      schema: { type: 'null' }
    }, null)

    expect(result.passed).toBe(true)
  })

  it('passes required and properties together', () => {
    const result = evaluateJsonSchemaGate({
      type: 'json_schema',
      schema: {
        type: 'object',
        required: ['name'],
        properties: { name: { type: 'string' } }
      }
    }, { name: 'A' })

    expect(result.passed).toBe(true)
  })

  it('returns multiple missing required details', () => {
    const result = evaluateJsonSchemaGate({
      type: 'json_schema',
      schema: {
        type: 'object',
        required: ['name', 'email']
      }
    }, {})

    expect(result.passed).toBe(false)
    expect(Array.isArray(result.details)).toBe(true)
    expect((result.details as Array<unknown>).length).toBe(2)
  })

  it('passes zod object schema', () => {
    const result = evaluateJsonSchemaGate({
      type: 'json_schema',
      schema: z.object({ name: z.string() })
    }, { name: 'N' })

    expect(result.passed).toBe(true)
  })

  it('fails zod object schema', () => {
    const result = evaluateJsonSchemaGate({
      type: 'json_schema',
      schema: z.object({ name: z.string() })
    }, { name: 1 })

    expect(result.passed).toBe(false)
    expect(result.reason).toContain('name')
  })

  it('reports zod nested path', () => {
    const result = evaluateJsonSchemaGate({
      type: 'json_schema',
      schema: z.object({ user: z.object({ email: z.string().email() }) })
    }, { user: { email: 'nope' } })

    expect(result.passed).toBe(false)
    expect(JSON.stringify(result.details)).toContain('user.email')
  })

  it('reports zod array path', () => {
    const result = evaluateJsonSchemaGate({
      type: 'json_schema',
      schema: z.array(z.object({ id: z.number() }))
    }, [{ id: 1 }, { id: 'x' }])

    expect(result.passed).toBe(false)
    expect(JSON.stringify(result.details)).toContain('1.id')
  })

  it('infers object type when only required is provided', () => {
    const result = evaluateJsonSchemaGate({
      type: 'json_schema',
      schema: { required: ['a'] }
    }, { a: 1 })

    expect(result.passed).toBe(true)
  })

  it('fails inferred object type on primitive', () => {
    const result = evaluateJsonSchemaGate({
      type: 'json_schema',
      schema: { required: ['a'] }
    }, 'x')

    expect(result.passed).toBe(false)
  })

  it('passes nested array object schema', () => {
    const result = evaluateJsonSchemaGate({
      type: 'json_schema',
      schema: {
        type: 'array',
        items: {
          type: 'object',
          required: ['name'],
          properties: { name: { type: 'string' } }
        }
      }
    }, [{ name: 'ok' }])

    expect(result.passed).toBe(true)
  })

  it('fails nested array object schema with path', () => {
    const result = evaluateJsonSchemaGate({
      type: 'json_schema',
      schema: {
        type: 'array',
        items: {
          type: 'object',
          required: ['name']
        }
      }
    }, [{}])

    expect(result.passed).toBe(false)
    expect(JSON.stringify(result.details)).toContain('0.name')
  })

  it('passes when required is empty', () => {
    const result = evaluateJsonSchemaGate({
      type: 'json_schema',
      schema: { type: 'object', required: [] }
    }, {})

    expect(result.passed).toBe(true)
  })

  it('ignores unknown extra properties', () => {
    const result = evaluateJsonSchemaGate({
      type: 'json_schema',
      schema: { type: 'object', properties: { name: { type: 'string' } } }
    }, { name: 'A', extra: true })

    expect(result.passed).toBe(true)
  })

  it('uses custom gate name when provided', () => {
    const result = evaluateJsonSchemaGate({
      type: 'json_schema',
      name: 'shape-check',
      schema: { type: 'object', required: ['id'] }
    }, {})

    expect(result.gate).toBe('shape-check')
  })
})
