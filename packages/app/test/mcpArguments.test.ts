import { describe, expect, it } from 'vitest'
import { validateMcpArguments } from '../src/mcpServer'

describe('targeted MCP argument validation', () => {
  it('distinguishes an omitted schema from an invalid declared schema', () => {
    expect(() => validateMcpArguments(undefined, { value: 1 }, 'tools/opaque')).not.toThrow()
    for (const schema of [null, false, [], { type: 'string' }, { properties: { value: 'not-a-schema' } }]) {
      expect(() => validateMcpArguments(schema, {}, 'tools/invalid')).toThrow(/invalid input schema/)
    }
  })

  it('preserves draft-07 tuple validation through the MCP boundary', () => {
    const schema = {
      $schema: 'http://json-schema.org/draft-07/schema#',
      type: 'object',
      properties: {
        tuple: { type: 'array', items: [{ type: 'string' }, { type: 'integer' }], additionalItems: false },
      },
    }
    expect(() => validateMcpArguments(schema, { tuple: ['value', 2] }, 'tools/tuple')).not.toThrow()
    expect(() => validateMcpArguments(schema, { tuple: [2, 'value'] }, 'tools/tuple')).toThrow()
    expect(() => validateMcpArguments(schema, { tuple: ['value', 2, true] }, 'tools/tuple')).toThrow()
  })

  it('does not allow one selected schema to poison another with the same $id', () => {
    const first = { $id: 'https://schema.test/shared', type: 'object', required: ['first'] }
    const second = { $id: 'https://schema.test/shared', type: 'object', required: ['second'] }
    expect(() => validateMcpArguments(first, { first: true }, 'tools/first')).not.toThrow()
    expect(() => validateMcpArguments(second, { first: true }, 'tools/second')).toThrow()
    expect(() => validateMcpArguments(second, { second: true }, 'tools/second')).not.toThrow()
  })

  it('rejects deeply nested schemas before compiling them', () => {
    let nested: unknown = { type: 'string' }
    for (let i = 0; i < 40; i += 1) nested = { type: 'object', properties: { nested } }
    expect(() => validateMcpArguments(nested, {}, 'tools/deep')).toThrow(/invalid input schema/)
  })
})
