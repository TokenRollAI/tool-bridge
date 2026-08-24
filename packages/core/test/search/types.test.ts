import { describe, expect, it } from 'vitest'
import {
  assertKeywordToolSearchMode,
  decodeToolSearchCursor,
  encodeToolSearchCursor,
  prepareToolSearchUnits,
  serializeToolSearchDocuments,
  serializeToolSearchSnapshot,
  TBError,
  TOOL_SEARCH_AUDIT_NODE_LIMIT,
  TOOL_SEARCH_DESCRIPTION_BYTES_MAX,
  TOOL_SEARCH_LIKE_PATTERN_BYTES_MAX,
  TOOL_SEARCH_NODE_JSON_BYTES_MAX,
  TOOL_SEARCH_QUERY_MAX,
  TOOL_SEARCH_REBUILD_CHUNKS_MAX,
  TOOL_SEARCH_TERM_LIMIT,
  TOOL_SEARCH_UNIT_LIMIT,
  type ToolSearchOptions,
  toolSearchSnapshotDigest,
} from '../../src'

declare const TextEncoder: { new (): { encode(input: string): Uint8Array } }

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

  it('expands CJK terms into whole-word, bigram and single-code-point tiers', () => {
    expect(prepareToolSearchUnits(' 发送信件 ')).toEqual([
      { pattern: '%发送信件%', tier: 4 },
      { pattern: '%发送%', tier: 2 },
      { pattern: '%送信%', tier: 2 },
      { pattern: '%信件%', tier: 2 },
      { pattern: '%发%', tier: 1 },
      { pattern: '%送%', tier: 1 },
      { pattern: '%信%', tier: 1 },
      { pattern: '%件%', tier: 1 },
    ])
  })

  it('adds maximal script runs for mixed terms and recognizes Han, kana and Hangul', () => {
    expect(prepareToolSearchUnits('tb发送')).toEqual([
      { pattern: '%tb发送%', tier: 4 },
      { pattern: '%tb%', tier: 2 },
      { pattern: '%发送%', tier: 2 },
      { pattern: '%发%', tier: 1 },
      { pattern: '%送%', tier: 1 },
    ])
    expect(prepareToolSearchUnits('日 かな カナ 한글')).toEqual([
      { pattern: '%日%', tier: 4 },
      { pattern: '%かな%', tier: 4 },
      { pattern: '%カナ%', tier: 4 },
      { pattern: '%한글%', tier: 4 },
      { pattern: '%か%', tier: 1 },
      { pattern: '%な%', tier: 1 },
      { pattern: '%カ%', tier: 1 },
      { pattern: '%ナ%', tier: 1 },
      { pattern: '%한%', tier: 1 },
      { pattern: '%글%', tier: 1 },
    ])
  })

  it('deduplicates patterns at their highest tier and escapes LIKE metacharacters', () => {
    expect(prepareToolSearchUnits('日程 日')).toEqual([
      { pattern: '%日程%', tier: 4 },
      { pattern: '%日%', tier: 4 },
      { pattern: '%程%', tier: 1 },
    ])
    expect(prepareToolSearchUnits('%_!')).toEqual([
      { pattern: '%!%!_!!%', tier: 4 },
    ])
  })

  it('validates query boundaries and the whitespace term limit', () => {
    expect(() => prepareToolSearchUnits('   ')).toThrowError(TBError)
    expect(() => prepareToolSearchUnits('calendar\0private')).toThrowError(TBError)
    expect(() => prepareToolSearchUnits('x'.repeat(TOOL_SEARCH_QUERY_MAX + 1)))
      .toThrowError(TBError)
    const tooManyShortTerms = Array.from(
      { length: TOOL_SEARCH_TERM_LIMIT + 1 },
      () => 'a',
    ).join(' ')
    expect(() => prepareToolSearchUnits(tooManyShortTerms)).toThrowError(TBError)
  })

  it('keeps every LIKE pattern within the D1 byte and binding budgets', () => {
    const longAscii = `%_!${'abcdefghijklmnop'.repeat(8)}`
    const asciiUnits = prepareToolSearchUnits(longAscii)
    const longCjk = Array.from(
      { length: 70 },
      (_, index) => String.fromCodePoint(0x4E00 + index),
    ).join('')
    const cjkUnits = prepareToolSearchUnits(longCjk)

    expect(TOOL_SEARCH_UNIT_LIMIT + 2).toBe(100)
    expect(asciiUnits.some(unit => unit.tier === 2)).toBe(true)
    expect(cjkUnits).not.toContainEqual({ pattern: `%${longCjk}%`, tier: 4 })
    expect(cjkUnits).toContainEqual({ pattern: `%${longCjk.slice(0, 2)}%`, tier: 2 })
    for (const unit of [...asciiUnits, ...cjkUnits]) {
      expect(new TextEncoder().encode(unit.pattern).length)
        .toBeLessThanOrEqual(TOOL_SEARCH_LIKE_PATTERN_BYTES_MAX)
    }
  })

  it('deterministically truncates derived units from the lowest tier first', () => {
    const query = Array.from({ length: 32 }, (_, termIndex) => Array.from(
      { length: 3 },
      (_, codePointIndex) => String.fromCodePoint(0x4E00 + termIndex * 3 + codePointIndex),
    ).join('')).join(' ')
    const first = prepareToolSearchUnits(query)
    const second = prepareToolSearchUnits(query)

    expect(first).toHaveLength(TOOL_SEARCH_UNIT_LIMIT)
    expect(first).toEqual(second)
    expect(first.filter(unit => unit.tier === 4)).toHaveLength(32)
    expect(first.filter(unit => unit.tier === 2)).toHaveLength(64)
    expect(first.filter(unit => unit.tier === 1)).toHaveLength(2)
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
