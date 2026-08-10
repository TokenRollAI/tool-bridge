import { describe, expect, it } from 'vitest'
import {
  assertKeywordToolSearchMode,
  literalToolSearchQuery,
  serializeToolSearchHits,
  serializeToolSearchSnapshot,
  TBError,
  type ToolSearchOptions,
} from '../../src'

describe('SearchIndex mutation contract', () => {
  it('normalizes path and preserves the complete raw ToolSpec JSON', () => {
    const [record] = serializeToolSearchSnapshot('/providers/calendar/', [
      {
        name: 'find_events',
        description: 'Find calendar events',
        effect: 'read',
        confirm: true,
        inputSchema: {
          type: 'object',
          properties: { query: { type: 'string' } },
          required: ['query'],
        },
      },
    ])

    expect(record).toMatchObject({
      path: 'providers/calendar',
      name: 'find_events',
      description: 'Find calendar events',
    })
    expect(JSON.parse(record?.toolJson ?? '{}')).toEqual({
      name: 'find_events',
      description: 'Find calendar events',
      effect: 'read',
      confirm: true,
      inputSchema: {
        type: 'object',
        properties: { query: { type: 'string' } },
        required: ['query'],
      },
    })
  })

  it('rejects duplicate identities, invalid paths and non-JSON tool data', () => {
    expect(() => serializeToolSearchSnapshot('providers/calendar', [
      { name: 'find' },
      { name: 'find' },
    ])).toThrowError(TBError)
    expect(() => serializeToolSearchHits([
      { path: 'providers/calendar', tool: { name: 'find' } },
      { path: '/providers/calendar/', tool: { name: 'find' } },
    ])).toThrowError(TBError)
    expect(() => serializeToolSearchSnapshot('providers/~private', [{ name: 'find' }]))
      .toThrowError(TBError)
    expect(() => serializeToolSearchSnapshot('providers/calendar', [
      { name: 'find', inputSchema: { invalid: 1n } },
    ])).toThrowError(TBError)
  })

  it('quotes every keyword term as literal FTS input', () => {
    expect(literalToolSearchQuery('  active   users  ')).toBe('"active" "users"')
    expect(literalToolSearchQuery('calendar OR "private"')).toBe(
      '"calendar" "OR" """private"""',
    )
    expect(() => literalToolSearchQuery('   ')).toThrowError(TBError)
    expect(() => literalToolSearchQuery('calendar\0private')).toThrowError(TBError)
  })

  it('keeps the adapter mode contract narrow and fails closed at runtime', () => {
    expect(() => assertKeywordToolSearchMode()).not.toThrow()
    expect(() => assertKeywordToolSearchMode({ mode: 'keyword' })).not.toThrow()
    expect(() => assertKeywordToolSearchMode({ mode: 'semantic' })).toThrowError(TBError)
    expect(() => assertKeywordToolSearchMode({ mode: 'regex' } as unknown as ToolSearchOptions))
      .toThrowError(TBError)
  })
})
