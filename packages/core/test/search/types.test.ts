import { describe, expect, it } from 'vitest'
import {
  assertKeywordToolSearchMode,
  decodeToolSearchCursor,
  encodeToolSearchCursor,
  literalToolSearchQuery,
  prepareToolSearchQuery,
  serializeToolSearchDocuments,
  serializeToolSearchSnapshot,
  TBError,
  TOOL_SEARCH_AUDIT_NODE_LIMIT,
  TOOL_SEARCH_DESCRIPTION_BYTES_MAX,
  TOOL_SEARCH_NODE_JSON_BYTES_MAX,
  TOOL_SEARCH_QUERY_MAX,
  TOOL_SEARCH_REBUILD_CHUNKS_MAX,
  TOOL_SEARCH_TERM_LIMIT,
  type ToolSearchOptions,
  toolSearchSnapshotDigest,
} from '../../src'

describe('SearchIndex mutation contract', () => {
  it('normalizes path and stores only lightweight searchable material plus a digest', () => {
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
      toolDigest: expect.stringMatching(/^[a-f0-9]{16}$/),
    })
  })

  it('rejects duplicate identities, invalid paths and non-JSON tool data', () => {
    expect(() => serializeToolSearchSnapshot('providers/calendar', [
      { name: 'find' },
      { name: 'find' },
    ])).toThrowError(TBError)
    expect(() => serializeToolSearchDocuments([
      { path: 'providers/calendar', tool: { name: 'find' } },
      { path: '/providers/calendar/', tool: { name: 'find' } },
    ])).toThrowError(TBError)
    expect(() => serializeToolSearchSnapshot('providers/~private', [{ name: 'find' }]))
      .toThrowError(TBError)
    expect(() => serializeToolSearchSnapshot('providers/calendar', [
      { name: 'find', inputSchema: { invalid: 1n } },
    ])).toThrowError(TBError)
    expect(() => serializeToolSearchSnapshot('providers/calendar', Array.from(
      { length: 500 },
      (_, index) => ({ name: `node_capacity_${index}_${'x'.repeat(64)}` }),
    ))).toThrowError(TBError)
    expect(TOOL_SEARCH_REBUILD_CHUNKS_MAX).toBeLessThanOrEqual(20)
  })

  it('truncates long descriptions without rejecting the complete canonical ToolSpec', () => {
    const description = '飞'.repeat(10_000)
    const [record] = serializeToolSearchSnapshot('providers/feishu', [{
      name: 'create-doc',
      description,
      inputSchema: { type: 'object', properties: { markdown: { type: 'string' } } },
    }])
    expect(Array.from(record?.description ?? '')).toHaveLength(
      Math.floor(TOOL_SEARCH_DESCRIPTION_BYTES_MAX / 3),
    )
    expect(record?.description).not.toBe(description)
    expect(TOOL_SEARCH_NODE_JSON_BYTES_MAX).toBeGreaterThan(TOOL_SEARCH_DESCRIPTION_BYTES_MAX)
  })

  it('does not impose an artificial tool-count limit below the JSON budget', () => {
    const tools = Array.from({ length: 125 }, (_, index) => ({ name: `tool_${index}` }))
    expect(serializeToolSearchSnapshot('providers/calendar', tools)).toHaveLength(125)
    expect(serializeToolSearchDocuments(tools.map(tool => ({
      path: 'providers/calendar',
      tool,
    })))).toHaveLength(125)
    expect(() => serializeToolSearchDocuments(Array.from(
      { length: TOOL_SEARCH_AUDIT_NODE_LIMIT + 1 },
      (_, index) => ({ path: `providers/${index}`, tool: { name: 'probe' } }),
    ))).toThrowError(TBError)
  })

  it('keeps snapshot digest stable across order but changes with searchable material', () => {
    const a = serializeToolSearchSnapshot('providers/calendar', [
      { name: 'a', description: 'one' },
      { name: 'b', description: 'two' },
    ])
    const reordered = serializeToolSearchSnapshot('providers/calendar', [
      { name: 'b', description: 'two' },
      { name: 'a', description: 'one' },
    ])
    const changed = serializeToolSearchSnapshot(
      'providers/calendar',
      [{ name: 'a', description: 'one' }, { name: 'b', description: 'two' }],
      'feedback',
    )
    expect(toolSearchSnapshotDigest(a)).toBe(toolSearchSnapshotDigest(reordered))
    expect(toolSearchSnapshotDigest(changed)).not.toBe(toolSearchSnapshotDigest(a))
  })

  it('quotes every keyword term as literal FTS input', () => {
    expect(literalToolSearchQuery('  active   users  ')).toBe('"active" "users"')
    expect(literalToolSearchQuery('calendar OR "private"')).toBe(
      '"calendar" "OR" """private"""',
    )
    expect(() => literalToolSearchQuery('   ')).toThrowError(TBError)
    expect(() => literalToolSearchQuery('calendar\0private')).toThrowError(TBError)
    expect(() => literalToolSearchQuery('x'.repeat(TOOL_SEARCH_QUERY_MAX + 1)))
      .toThrowError(TBError)
  })

  it('uses Unicode code points and escapes literal LIKE metacharacters for short queries', () => {
    expect(prepareToolSearchQuery(' 日程 ')).toEqual({
      kind: 'like',
      patterns: ['%日程%'],
    })
    expect(prepareToolSearchQuery('管理日')).toEqual({
      kind: 'fts',
      expression: '"管理日"',
    })
    expect(prepareToolSearchQuery('😀a')).toEqual({
      kind: 'like',
      patterns: ['%😀a%'],
    })
    expect(prepareToolSearchQuery('😀ab')).toEqual({
      kind: 'fts',
      expression: '"😀ab"',
    })
    expect(prepareToolSearchQuery('%_')).toEqual({
      kind: 'like',
      patterns: ['%!%!_%'],
    })
    expect(prepareToolSearchQuery('!')).toEqual({ kind: 'like', patterns: ['%!!%'] })
    expect(prepareToolSearchQuery('a b')).toEqual({
      kind: 'like',
      patterns: ['%a%', '%b%'],
    })
    expect(prepareToolSearchQuery('AI calendar')).toEqual({
      kind: 'hybrid',
      expression: '"calendar"',
      patterns: ['%AI%'],
    })
    const tooManyShortTerms = Array.from(
      { length: TOOL_SEARCH_TERM_LIMIT + 1 },
      () => 'a',
    ).join(' ')
    expect(() => prepareToolSearchQuery(tooManyShortTerms)).toThrowError(TBError)
  })

  it('encrypts cursors and binds them to query, mode, revision and bounded offset', async () => {
    const secret = '01'.repeat(32)
    const cursor = await encodeToolSearchCursor(' calendar ', 'keyword', 7, 42, secret)
    await expect(decodeToolSearchCursor(cursor, 'calendar', 'keyword', 7, secret)).resolves.toBe(42)
    await expect(decodeToolSearchCursor(cursor, 'weather', 'keyword', 7, secret))
      .rejects.toBeInstanceOf(TBError)
    await expect(decodeToolSearchCursor(cursor, 'calendar', 'keyword', 8, secret))
      .rejects.toBeInstanceOf(TBError)
    const bytes = [...cursor]
    bytes[Math.floor(bytes.length / 2)] = bytes[Math.floor(bytes.length / 2)] === 'A' ? 'B' : 'A'
    await expect(decodeToolSearchCursor(bytes.join(''), 'calendar', 'keyword', 7, secret))
      .rejects.toBeInstanceOf(TBError)

    const cjkQuery = '日'.repeat(TOOL_SEARCH_QUERY_MAX)
    const cjkCursor = await encodeToolSearchCursor(cjkQuery, 'keyword', 7, 42, secret)
    await expect(decodeToolSearchCursor(cjkCursor, cjkQuery, 'keyword', 7, secret))
      .resolves.toBe(42)
  })

  it('keeps the adapter mode contract narrow and fails closed at runtime', () => {
    expect(() => assertKeywordToolSearchMode()).not.toThrow()
    expect(() => assertKeywordToolSearchMode({ mode: 'keyword' })).not.toThrow()
    expect(() => assertKeywordToolSearchMode({ mode: 'semantic' })).toThrowError(TBError)
    expect(() => assertKeywordToolSearchMode({ mode: 'regex' } as unknown as ToolSearchOptions))
      .toThrowError(TBError)
  })
})
