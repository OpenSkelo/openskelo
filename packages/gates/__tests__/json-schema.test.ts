import { describe, it, expect } from 'vitest'
import { z } from 'zod'
import { jsonSchemaGate } from '../src/gates/json-schema.js'

describe('json_schema gate', () => {
  // ── Simple object mode (required fields) ──

  describe('simple object mode', () => {
    it('passes when all required fields are present', async () => {
      const result = await jsonSchemaGate(
        { price: 42, analysis: 'good' },
        { type: 'json_schema', schema: { required: ['price', 'analysis'] } },
      )
      expect(result.passed).toBe(true)
      expect(result.gate).toBe('json_schema')
      expect(result.duration_ms).toBeGreaterThanOrEqual(0)
    })

    it('fails when required fields are missing', async () => {
      const result = await jsonSchemaGate(
        { price: 42 },
        { type: 'json_schema', schema: { required: ['price', 'analysis'] } },
      )
      expect(result.passed).toBe(false)
      expect(result.reason).toContain('analysis')
    })

    it('fails when multiple required fields are missing', async () => {
      const result = await jsonSchemaGate(
        {},
        { type: 'json_schema', schema: { required: ['price', 'analysis', 'summary'] } },
      )
      expect(result.passed).toBe(false)
      expect(result.reason).toContain('price')
      expect(result.reason).toContain('analysis')
      expect(result.reason).toContain('summary')
    })

    it('passes with extra fields beyond required', async () => {
      const result = await jsonSchemaGate(
        { price: 42, analysis: 'good', extra: true },
        { type: 'json_schema', schema: { required: ['price', 'analysis'] } },
      )
      expect(result.passed).toBe(true)
    })

    it('passes with empty required array', async () => {
      const result = await jsonSchemaGate(
        { anything: 'goes' },
        { type: 'json_schema', schema: { required: [] } },
      )
      expect(result.passed).toBe(true)
    })

    it('passes with no required array specified', async () => {
      const result = await jsonSchemaGate(
        { anything: 'goes' },
        { type: 'json_schema', schema: {} },
      )
      expect(result.passed).toBe(true)
    })

    it('treats null values as present', async () => {
      const result = await jsonSchemaGate(
        { price: null },
        { type: 'json_schema', schema: { required: ['price'] } },
      )
      expect(result.passed).toBe(true)
    })

    it('treats undefined values as missing', async () => {
      const result = await jsonSchemaGate(
        { price: undefined },
        { type: 'json_schema', schema: { required: ['price'] } },
      )
      expect(result.passed).toBe(false)
    })
  })

  // ── Zod schema mode ──

  describe('Zod schema mode', () => {
    it('passes with valid data against Zod schema', async () => {
      const schema = z.object({
        price: z.number(),
        analysis: z.string(),
      })
      const result = await jsonSchemaGate(
        { price: 42.5, analysis: 'bullish' },
        { type: 'json_schema', schema },
      )
      expect(result.passed).toBe(true)
    })

    it('fails with invalid types against Zod schema', async () => {
      const schema = z.object({
        price: z.number(),
        analysis: z.string(),
      })
      const result = await jsonSchemaGate(
        { price: 'not-a-number', analysis: 'good' },
        { type: 'json_schema', schema },
      )
      expect(result.passed).toBe(false)
      expect(result.reason).toBeDefined()
    })

    it('fails when Zod required fields are missing', async () => {
      const schema = z.object({
        price: z.number(),
        analysis: z.string(),
      })
      const result = await jsonSchemaGate(
        { price: 42 },
        { type: 'json_schema', schema },
      )
      expect(result.passed).toBe(false)
    })

    it('validates nested objects with Zod', async () => {
      const schema = z.object({
        meta: z.object({
          author: z.string(),
          version: z.number(),
        }),
      })
      const result = await jsonSchemaGate(
        { meta: { author: 'test', version: 1 } },
        { type: 'json_schema', schema },
      )
      expect(result.passed).toBe(true)
    })

    it('fails on invalid nested objects with Zod', async () => {
      const schema = z.object({
        meta: z.object({
          author: z.string(),
          version: z.number(),
        }),
      })
      const result = await jsonSchemaGate(
        { meta: { author: 123, version: 'bad' } },
        { type: 'json_schema', schema },
      )
      expect(result.passed).toBe(false)
      expect(result.details).toBeDefined()
    })

    it('validates arrays with Zod', async () => {
      const schema = z.object({
        items: z.array(z.string()),
      })
      const result = await jsonSchemaGate(
        { items: ['a', 'b', 'c'] },
        { type: 'json_schema', schema },
      )
      expect(result.passed).toBe(true)
    })

    it('fails on invalid array items with Zod', async () => {
      const schema = z.object({
        items: z.array(z.string()),
      })
      const result = await jsonSchemaGate(
        { items: ['a', 42, 'c'] },
        { type: 'json_schema', schema },
      )
      expect(result.passed).toBe(false)
    })

    it('provides Zod error details on failure', async () => {
      const schema = z.object({
        price: z.number().min(0).max(100),
      })
      const result = await jsonSchemaGate(
        { price: 200 },
        { type: 'json_schema', schema },
      )
      expect(result.passed).toBe(false)
      expect(result.details).toBeDefined()
      expect(Array.isArray(result.details)).toBe(true)
    })

    it('validates with Zod enum types', async () => {
      const schema = z.object({
        status: z.enum(['buy', 'sell', 'hold']),
      })
      const pass = await jsonSchemaGate(
        { status: 'buy' },
        { type: 'json_schema', schema },
      )
      expect(pass.passed).toBe(true)

      const fail = await jsonSchemaGate(
        { status: 'invalid' },
        { type: 'json_schema', schema },
      )
      expect(fail.passed).toBe(false)
    })

    it('validates optional Zod fields', async () => {
      const schema = z.object({
        name: z.string(),
        age: z.number().optional(),
      })
      const result = await jsonSchemaGate(
        { name: 'Alice' },
        { type: 'json_schema', schema },
      )
      expect(result.passed).toBe(true)
    })
  })

  // ── Type checking (SimpleJsonSchema) ──

  describe('type checking', () => {
    it('passes when value matches expected type: string', async () => {
      const result = await jsonSchemaGate(
        'hello',
        { type: 'json_schema', schema: { type: 'string' } },
      )
      expect(result.passed).toBe(true)
    })

    it('fails when string expected but number given', async () => {
      const result = await jsonSchemaGate(
        42,
        { type: 'json_schema', schema: { type: 'string' } },
      )
      expect(result.passed).toBe(false)
      expect(result.reason).toContain('Expected string')
      expect(result.reason).toContain('number')
    })

    it('passes when value matches expected type: number', async () => {
      const result = await jsonSchemaGate(
        42,
        { type: 'json_schema', schema: { type: 'number' } },
      )
      expect(result.passed).toBe(true)
    })

    it('fails when number expected but string given', async () => {
      const result = await jsonSchemaGate(
        'hello',
        { type: 'json_schema', schema: { type: 'number' } },
      )
      expect(result.passed).toBe(false)
      expect(result.reason).toContain('Expected number')
    })

    it('passes when value matches expected type: boolean', async () => {
      const result = await jsonSchemaGate(
        true,
        { type: 'json_schema', schema: { type: 'boolean' } },
      )
      expect(result.passed).toBe(true)
    })

    it('passes when value matches expected type: null', async () => {
      const result = await jsonSchemaGate(
        null,
        { type: 'json_schema', schema: { type: 'null' } },
      )
      expect(result.passed).toBe(true)
    })

    it('passes when value matches expected type: array', async () => {
      const result = await jsonSchemaGate(
        [1, 2, 3],
        { type: 'json_schema', schema: { type: 'array' } },
      )
      expect(result.passed).toBe(true)
    })

    it('fails when object expected but array given', async () => {
      const result = await jsonSchemaGate(
        [1, 2, 3],
        { type: 'json_schema', schema: { type: 'object' } },
      )
      expect(result.passed).toBe(false)
      expect(result.reason).toContain('Expected object')
      expect(result.reason).toContain('array')
    })

    it('infers object type from properties key', async () => {
      const result = await jsonSchemaGate(
        'not an object',
        { type: 'json_schema', schema: { properties: { name: { type: 'string' } } } },
      )
      expect(result.passed).toBe(false)
      expect(result.reason).toContain('Expected object')
    })

    it('infers object type from required key', async () => {
      const result = await jsonSchemaGate(
        42,
        { type: 'json_schema', schema: { required: ['name'] } },
      )
      expect(result.passed).toBe(false)
      expect(result.reason).toContain('Expected object')
    })
  })

  // ── Nested property validation ──

  describe('nested property validation', () => {
    it('validates nested object properties', async () => {
      const result = await jsonSchemaGate(
        { meta: { author: 'Alice', version: 2 } },
        {
          type: 'json_schema',
          schema: {
            type: 'object',
            properties: {
              meta: {
                type: 'object',
                required: ['author', 'version'],
                properties: {
                  author: { type: 'string' },
                  version: { type: 'number' },
                },
              },
            },
          },
        },
      )
      expect(result.passed).toBe(true)
    })

    it('fails on type mismatch in nested property', async () => {
      const result = await jsonSchemaGate(
        { meta: { author: 123 } },
        {
          type: 'json_schema',
          schema: {
            type: 'object',
            properties: {
              meta: {
                type: 'object',
                properties: {
                  author: { type: 'string' },
                },
              },
            },
          },
        },
      )
      expect(result.passed).toBe(false)
      expect(result.reason).toContain('meta.author')
    })

    it('skips validation for absent optional properties', async () => {
      const result = await jsonSchemaGate(
        { name: 'test' },
        {
          type: 'json_schema',
          schema: {
            type: 'object',
            properties: {
              name: { type: 'string' },
              age: { type: 'number' },
            },
          },
        },
      )
      expect(result.passed).toBe(true)
    })

    it('fails on missing required nested field', async () => {
      const result = await jsonSchemaGate(
        { meta: {} },
        {
          type: 'json_schema',
          schema: {
            type: 'object',
            properties: {
              meta: {
                type: 'object',
                required: ['author'],
              },
            },
          },
        },
      )
      expect(result.passed).toBe(false)
      expect(result.reason).toContain('meta.author')
    })
  })

  // ── Array items validation ──

  describe('array items validation', () => {
    it('validates array items against items schema', async () => {
      const result = await jsonSchemaGate(
        ['hello', 'world'],
        { type: 'json_schema', schema: { type: 'array', items: { type: 'string' } } },
      )
      expect(result.passed).toBe(true)
    })

    it('fails when array item has wrong type', async () => {
      const result = await jsonSchemaGate(
        ['hello', 42, 'world'],
        { type: 'json_schema', schema: { type: 'array', items: { type: 'string' } } },
      )
      expect(result.passed).toBe(false)
      expect(result.reason).toContain('Expected string')
    })

    it('validates array of objects', async () => {
      const result = await jsonSchemaGate(
        [{ name: 'Alice' }, { name: 'Bob' }],
        {
          type: 'json_schema',
          schema: {
            type: 'array',
            items: {
              type: 'object',
              required: ['name'],
              properties: { name: { type: 'string' } },
            },
          },
        },
      )
      expect(result.passed).toBe(true)
    })

    it('fails on invalid item in array of objects', async () => {
      const result = await jsonSchemaGate(
        [{ name: 'Alice' }, { name: 123 }],
        {
          type: 'json_schema',
          schema: {
            type: 'array',
            items: {
              type: 'object',
              properties: { name: { type: 'string' } },
            },
          },
        },
      )
      expect(result.passed).toBe(false)
    })

    it('passes empty array against items schema', async () => {
      const result = await jsonSchemaGate(
        [],
        { type: 'json_schema', schema: { type: 'array', items: { type: 'string' } } },
      )
      expect(result.passed).toBe(true)
    })
  })

  // ── Path reporting ──

  describe('path reporting', () => {
    it('reports root path as $ for top-level type mismatch', async () => {
      const result = await jsonSchemaGate(
        'wrong',
        { type: 'json_schema', schema: { type: 'number' } },
      )
      expect(result.passed).toBe(false)
      expect(result.reason).toContain('$')
    })

    it('reports dotted path for nested failures', async () => {
      const result = await jsonSchemaGate(
        { user: { age: 'not a number' } },
        {
          type: 'json_schema',
          schema: {
            type: 'object',
            properties: {
              user: {
                type: 'object',
                properties: { age: { type: 'number' } },
              },
            },
          },
        },
      )
      expect(result.passed).toBe(false)
      expect(result.reason).toContain('user.age')
    })

    it('reports array index in path', async () => {
      const result = await jsonSchemaGate(
        [1, 'bad', 3],
        { type: 'json_schema', schema: { type: 'array', items: { type: 'number' } } },
      )
      expect(result.passed).toBe(false)
      expect(result.reason).toContain('1')
    })

    it('reports details array with individual failures', async () => {
      const result = await jsonSchemaGate(
        {},
        { type: 'json_schema', schema: { required: ['a', 'b', 'c'] } },
      )
      expect(result.passed).toBe(false)
      expect(result.details).toHaveLength(3)
      expect(result.details[0]).toHaveProperty('path')
      expect(result.details[0]).toHaveProperty('message')
    })
  })

  // ── Edge cases ──

  describe('edge cases', () => {
    it('fails when data is not an object (string)', async () => {
      const result = await jsonSchemaGate(
        'not an object' as any,
        { type: 'json_schema', schema: { required: ['name'] } },
      )
      expect(result.passed).toBe(false)
    })

    it('fails when data is null', async () => {
      const result = await jsonSchemaGate(
        null as any,
        { type: 'json_schema', schema: { required: ['name'] } },
      )
      expect(result.passed).toBe(false)
    })

    it('fails when data is an array', async () => {
      const result = await jsonSchemaGate(
        [1, 2, 3] as any,
        { type: 'json_schema', schema: { required: ['name'] } },
      )
      expect(result.passed).toBe(false)
    })

    it('uses custom name in gate result', async () => {
      const result = await jsonSchemaGate(
        { price: 42 },
        { type: 'json_schema', schema: { required: ['price'] }, name: 'price check' },
      )
      expect(result.gate).toBe('price check')
    })

    it('tracks duration_ms', async () => {
      const result = await jsonSchemaGate(
        { a: 1 },
        { type: 'json_schema', schema: { required: ['a'] } },
      )
      expect(typeof result.duration_ms).toBe('number')
      expect(result.duration_ms).toBeGreaterThanOrEqual(0)
    })
  })
})
