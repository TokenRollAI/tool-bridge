import { describe, expect, it } from 'vitest'
import { ToolJsonSchemaValidator } from '../src/jsonSchemaValidator'

describe('official AJV external schema contracts', () => {
  it('isolates same-$id schemas from different tools', () => {
    const provider = new ToolJsonSchemaValidator()
    const first = provider.getValidator({ $id: 'https://schema.test/tool', type: 'object', required: ['first'] })
    const second = provider.getValidator({ $id: 'https://schema.test/tool', type: 'object', required: ['second'] })
    expect(first({ first: true }).valid).toBe(true)
    expect(second({ first: true }).valid).toBe(false)
    expect(second({ second: true }).valid).toBe(true)
  })

  it('enforces 2020-12 prefixItems, dependentRequired, unevaluatedProperties and local refs', () => {
    const validate = new ToolJsonSchemaValidator().getValidator({
      $schema: 'https://json-schema.org/draft/2020-12/schema',
      type: 'object',
      $defs: { positive: { type: 'integer', minimum: 1 } },
      properties: {
        amount: { $ref: '#/$defs/positive' },
        owner: { type: 'string', minLength: 1 },
        tuple: { type: 'array', prefixItems: [{ type: 'string' }, { type: 'integer' }], items: false },
      },
      dependentRequired: { amount: ['owner'] },
      unevaluatedProperties: false,
    })
    expect(validate({ amount: 1, owner: 'a', tuple: ['ok', 1] }).valid).toBe(true)
    for (const value of [{ amount: 0, owner: 'a' }, { amount: 1 }, { owner: 'a', tuple: [1, 'bad'] }, { owner: 'a', extra: true }]) expect(validate(value).valid).toBe(false)
  })

  it('preserves declared draft-07 dependencies and tuple constraints', () => {
    const validate = new ToolJsonSchemaValidator().getValidator({
      $schema: 'http://json-schema.org/draft-07/schema#',
      type: 'object',
      properties: { a: { type: 'integer' }, b: { type: 'string' }, tuple: { type: 'array', items: [{ type: 'string' }, { type: 'integer' }], additionalItems: false } },
      dependencies: { a: ['b'] },
    } as unknown as Parameters<ToolJsonSchemaValidator['getValidator']>[0])
    expect(validate({ a: 1, b: 'value', tuple: ['value', 2] }).valid).toBe(true)
    expect(validate({ a: 1 }).valid).toBe(false)
    expect(validate({ tuple: ['value', 2, true] }).valid).toBe(false)
  })

  it('validates formats without coercing, removing or defaulting caller data', () => {
    const validate = new ToolJsonSchemaValidator().getValidator({ type: 'object', properties: { email: { type: 'string', format: 'email' }, count: { type: 'integer', default: 1 } }, additionalProperties: false })
    const value = { email: 'name@example.com' }
    expect(validate(value).valid).toBe(true)
    expect(value).toEqual({ email: 'name@example.com' })
    expect(validate({ email: 'not-email' }).valid).toBe(false)
    expect(validate({ email: 'name@example.com', count: '1' }).valid).toBe(false)
    expect(validate({ email: 'name@example.com', extra: true }).valid).toBe(false)
  })

  it('rejects unresolved references and unsupported dialects instead of silently accepting', () => {
    const validator = new ToolJsonSchemaValidator()
    expect(() => validator.getValidator({ type: 'object', $ref: 'https://private.test/remote-schema' })).toThrow()
    expect(() => validator.getValidator({ $schema: 'https://unsupported.test/schema', type: 'object' })).toThrow()
  })
})
