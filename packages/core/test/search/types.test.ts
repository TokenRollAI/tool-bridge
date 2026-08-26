import { describe, expect, it } from 'vitest'
import {
  assertKeywordToolSearchMode,
  decodeToolSearchCursor,
  encodeToolSearchCursor,
  normalizeToolSearchLimit,
  normalizeToolSearchOptions,
  PG_SEARCH_SCHEMA_STATEMENTS,
  prepareToolSearchQuery,
  prepareToolSearchUnits,
  searchUnitAllowsPath,
  serializeToolSearchDocuments,
  serializeToolSearchSnapshot,
  TBError,
  TOOL_SEARCH_AUDIT_NODE_LIMIT,
  TOOL_SEARCH_DESCRIPTION_BYTES_MAX,
  TOOL_SEARCH_LIKE_PATTERN_BYTES_MAX,
  TOOL_SEARCH_LIMIT_DEFAULT,
  TOOL_SEARCH_NODE_JSON_BYTES_MAX,
  TOOL_SEARCH_QUERY_MAX,
  TOOL_SEARCH_REBUILD_CHUNKS_MAX,
  TOOL_SEARCH_SCHEMA_STATEMENTS,
  TOOL_SEARCH_TERM_LIMIT,
  TOOL_SEARCH_UNIT_LIMIT,
  toolSearchInsertPayload,
  type ToolSearchOptions,
  toolSearchSnapshotDigest,
} from '../../src'
import { sqliteSearchDialect } from '../../src/search/sqlSearchIndex'
import { base64urlEncode } from '../../src/encoding/base64url'

declare const TextEncoder: { new (): { encode(input: string): Uint8Array } }
interface TestCryptoKey { readonly type: string }
declare const crypto: {
  subtle: {
    encrypt(
      algorithm: { iv: Uint8Array, name: 'AES-GCM' },
      key: TestCryptoKey,
      data: Uint8Array,
    ): Promise<ArrayBuffer>
    importKey(
      format: 'raw',
      keyData: Uint8Array,
      algorithm: { name: 'AES-GCM' },
      extractable: false,
      keyUsages: ['encrypt'],
    ): Promise<TestCryptoKey>
  }
}

async function legacyV1Cursor(secret: string): Promise<string> {
  const keyBytes = Uint8Array.from(
    secret.match(/.{2}/g)?.map(value => Number.parseInt(value, 16)) ?? [],
  )
  const key = await crypto.subtle.importKey(
    'raw',
    keyBytes,
    { name: 'AES-GCM' },
    false,
    ['encrypt'],
  )
  const iv = new Uint8Array(12)
  const plaintext = new TextEncoder().encode(JSON.stringify({
    h: 'legacy-query-hash',
    m: 'keyword',
    o: 1,
    r: 7,
    v: 1,
  }))
  const ciphertext = new Uint8Array(await crypto.subtle.encrypt(
    { iv, name: 'AES-GCM' },
    key,
    plaintext,
  ))
  const sealed = new Uint8Array(iv.length + ciphertext.length)
  sealed.set(iv)
  sealed.set(ciphertext, iv.length)
  return base64urlEncode(sealed)
}

describe('SearchIndex mutation contract', () => {
  it('uses isolated v5 schemas with a constrained effect column on SQLite and Postgres', () => {
    for (const statements of [TOOL_SEARCH_SCHEMA_STATEMENTS, PG_SEARCH_SCHEMA_STATEMENTS]) {
      const schema = statements.join('\n')
      expect(schema).toContain('tb_search_tools_v5')
      expect(schema).toContain('tb_search_meta_v5')
      expect(schema).toContain('tb_search_snapshots_v5')
      expect(schema).toMatch(
        /effect (?:TEXT|text) NOT NULL CHECK \(effect IN \('read', 'write', 'destructive', 'unknown'\)\)/u,
      )
      expect(schema).not.toContain('tb_search_tools_v4')
    }
  })

  it('uses a search-specific default limit while preserving the global max', () => {
    expect(TOOL_SEARCH_LIMIT_DEFAULT).toBe(10)
    expect(normalizeToolSearchLimit(undefined)).toBe(10)
    expect(normalizeToolSearchLimit(0)).toBe(10)
    expect(normalizeToolSearchLimit(17)).toBe(17)
    expect(normalizeToolSearchLimit(201)).toBe(200)
    expect(() => normalizeToolSearchLimit(1.5)).toThrowError(TBError)
    expect(() => normalizeToolSearchLimit(Number.NaN)).toThrowError(TBError)
  })

  it('normalizes matching, coverage floor and path-prefix constraints fail closed', () => {
    expect(normalizeToolSearchOptions()).toEqual({ matching: 'best' })
    expect(normalizeToolSearchOptions({
      effects: ['unknown', 'read', 'read', 'destructive'],
      matching: 'best',
      minCoverage: 0.5,
      pathPrefix: '/HOME/Home-Assistant/',
    })).toEqual({
      effects: ['read', 'destructive', 'unknown'],
      matching: 'best',
      minCoverage: 0.5,
      pathPrefix: 'home/home-assistant',
    })
    expect(normalizeToolSearchOptions({ matching: 'all' })).toEqual({
      matching: 'all',
      minCoverage: 1,
    })
    expect(() => normalizeToolSearchOptions({ matching: 'all', minCoverage: 0.5 }))
      .toThrowError(TBError)
    for (const minCoverage of [0, -0.1, 1.1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => normalizeToolSearchOptions({ minCoverage })).toThrowError(TBError)
    }
    expect(() => normalizeToolSearchOptions({ matching: 'any' } as unknown as ToolSearchOptions))
      .toThrowError(TBError)
    expect(() => normalizeToolSearchOptions({ pathPrefix: 42 } as unknown as ToolSearchOptions))
      .toThrowError(TBError)
    expect(() => normalizeToolSearchOptions({ effects: [] })).toThrowError(TBError)
    expect(() => normalizeToolSearchOptions({ effects: ['safe'] } as unknown as ToolSearchOptions))
      .toThrowError(TBError)
    expect(() => normalizeToolSearchOptions({ effects: 'read' } as unknown as ToolSearchOptions))
      .toThrowError(TBError)
  })

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
      effect: 'read',
      toolDigest: expect.stringMatching(/^[a-f0-9]{16}$/),
    })
  })

  it('indexes only explicit effect enums and includes effect in payload and snapshot digest', () => {
    const records = serializeToolSearchSnapshot('providers/effects', [
      { name: 'read_tool', description: 'mutating prose', effect: 'read' },
      { name: 'write_tool', description: 'read-only prose', effect: 'write' },
      { name: 'destructive_tool', effect: 'destructive' },
      { name: 'missing_tool', description: 'safe read operation' },
      { name: 'invalid_tool', effect: 'READ' },
    ])
    expect(records.map(record => record.effect)).toEqual([
      'read',
      'write',
      'destructive',
      'unknown',
      'unknown',
    ])
    expect(toolSearchInsertPayload(records).map(record => record.effect)).toEqual([
      'read',
      'write',
      'destructive',
      'unknown',
      'unknown',
    ])
    const [unknownRecord] = serializeToolSearchSnapshot('providers/effects', [{ name: 'probe' }])
    if (unknownRecord === undefined) throw new Error('missing serialized effect fixture')
    expect(toolSearchSnapshotDigest([unknownRecord])).not.toBe(toolSearchSnapshotDigest([{
      ...unknownRecord,
      effect: 'read',
    }]))
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
      { logicalTermId: 0, pattern: '%发送信件%', tier: 4 },
      { logicalTermId: 0, pattern: '%发送%', tier: 2 },
      { logicalTermId: 0, pattern: '%送信%', tier: 2 },
      { logicalTermId: 0, pattern: '%信件%', tier: 2 },
      { logicalTermId: 0, pattern: '%发%', tier: 1 },
      { logicalTermId: 0, pattern: '%送%', tier: 1 },
      { logicalTermId: 0, pattern: '%信%', tier: 1 },
      { logicalTermId: 0, pattern: '%件%', tier: 1 },
    ])
  })

  it('adds maximal script runs for mixed terms and recognizes Han, kana and Hangul', () => {
    expect(prepareToolSearchUnits('tb发送')).toEqual([
      { logicalTermId: 0, pattern: '%tb发送%', tier: 4 },
      { logicalTermId: 0, pattern: '%tb%', tier: 2 },
      { logicalTermId: 0, pattern: '%发送%', tier: 2 },
      { logicalTermId: 0, pattern: '%发%', tier: 1 },
      { logicalTermId: 0, pattern: '%送%', tier: 1 },
    ])
    expect(prepareToolSearchUnits('日 かな カナ 한글')).toEqual([
      { logicalTermId: 0, pattern: '%日%', tier: 4 },
      { logicalTermId: 1, pattern: '%かな%', tier: 4 },
      { logicalTermId: 2, pattern: '%カナ%', tier: 4 },
      { logicalTermId: 3, pattern: '%한글%', tier: 4 },
      { logicalTermId: 1, pattern: '%か%', tier: 1 },
      { logicalTermId: 1, pattern: '%な%', tier: 1 },
      { logicalTermId: 2, pattern: '%カ%', tier: 1 },
      { logicalTermId: 2, pattern: '%ナ%', tier: 1 },
      { logicalTermId: 3, pattern: '%한%', tier: 1 },
      { logicalTermId: 3, pattern: '%글%', tier: 1 },
    ])
  })

  it('deduplicates patterns within each logical term and escapes LIKE metacharacters', () => {
    expect(prepareToolSearchUnits('日程 日')).toEqual([
      { logicalTermId: 0, pattern: '%日程%', tier: 4 },
      { logicalTermId: 1, pattern: '%日%', tier: 4 },
      { logicalTermId: 0, pattern: '%日%', tier: 1 },
      { logicalTermId: 0, pattern: '%程%', tier: 1 },
    ])
    expect(prepareToolSearchUnits('%_!')).toEqual([
      { logicalTermId: 0, pattern: '%!%!_!!%', tier: 4 },
    ])
  })

  it('deduplicates repeated normalized terms without inflating the coverage denominator', () => {
    expect(prepareToolSearchQuery(' home HOME home ')).toEqual({
      totalTermCount: 1,
      units: [{ logicalTermId: 0, pattern: '%home%', tier: 4 }],
    })
  })

  it('does not let short ASCII terms earn coverage from incidental path substrings', () => {
    const [short] = prepareToolSearchUnits('on')
    const [longer] = prepareToolSearchUnits('home')
    const [cjk] = prepareToolSearchUnits('日')
    expect(short === undefined || longer === undefined || cjk === undefined).toBe(false)
    expect(searchUnitAllowsPath(short!)).toBe(false)
    expect(searchUnitAllowsPath(longer!)).toBe(true)
    expect(searchUnitAllowsPath(cjk!)).toBe(true)
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
    const unscoped = sqliteSearchDialect.candidateStatement(longCjk, 10, 0)
    const scoped = sqliteSearchDialect.candidateStatement(
      longCjk,
      10,
      0,
      normalizeToolSearchOptions({
        effects: ['unknown', 'read'],
        pathPrefix: 'home/home-assistant',
      }),
    )

    expect(TOOL_SEARCH_UNIT_LIMIT + 2).toBe(100)
    expect(unscoped.params).toHaveLength(100)
    expect(scoped.params).toHaveLength(100)
    expect(scoped.params).not.toContain('read')
    expect(scoped.params).not.toContain('unknown')
    expect(scoped.sql).toContain('tools.effect IN (\'read\', \'unknown\')')
    expect(asciiUnits.some(unit => unit.tier === 2)).toBe(true)
    expect(cjkUnits).not.toContainEqual({
      logicalTermId: 0,
      pattern: `%${longCjk}%`,
      tier: 4,
    })
    expect(cjkUnits).toContainEqual({
      logicalTermId: 0,
      pattern: `%${longCjk.slice(0, 2)}%`,
      tier: 2,
    })
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

    const longTerms = Array.from({ length: 32 }, (_, termIndex) => Array.from(
      { length: 20 },
      (_, codePointIndex) => String.fromCodePoint(0x5000 + termIndex * 20 + codePointIndex),
    ).join('')).join(' ')
    const prepared = prepareToolSearchQuery(longTerms)
    expect(prepared.totalTermCount).toBe(32)
    expect(new Set(prepared.units.map(unit => unit.logicalTermId)).size).toBe(32)
  })

  it('encrypts cursors and binds query, mode, revision, options and bounded offset', async () => {
    const secret = '01'.repeat(32)
    const options: ToolSearchOptions = {
      effects: ['unknown', 'read', 'read'],
      matching: 'best',
      minCoverage: 0.5,
      pathPrefix: '/home/home-assistant/',
    }
    const cursor = await encodeToolSearchCursor(
      ' calendar ',
      'keyword',
      7,
      42,
      secret,
      options,
    )
    await expect(decodeToolSearchCursor(
      cursor,
      'calendar',
      'keyword',
      7,
      secret,
      { ...options, effects: ['read', 'unknown'], pathPrefix: 'home/home-assistant' },
    )).resolves.toBe(42)
    await expect(decodeToolSearchCursor(cursor, 'weather', 'keyword', 7, secret, options))
      .rejects.toBeInstanceOf(TBError)
    await expect(decodeToolSearchCursor(cursor, 'calendar', 'keyword', 8, secret, options))
      .rejects.toBeInstanceOf(TBError)
    await expect(decodeToolSearchCursor(cursor, 'calendar', 'keyword', 7, secret, {
      ...options,
      pathPrefix: 'home/other',
    })).rejects.toBeInstanceOf(TBError)
    await expect(decodeToolSearchCursor(cursor, 'calendar', 'keyword', 7, secret, {
      matching: 'all',
      pathPrefix: 'home/home-assistant',
    })).rejects.toBeInstanceOf(TBError)
    await expect(decodeToolSearchCursor(cursor, 'calendar', 'keyword', 7, secret, {
      ...options,
      minCoverage: 0.75,
    })).rejects.toBeInstanceOf(TBError)
    await expect(decodeToolSearchCursor(cursor, 'calendar', 'keyword', 7, secret, {
      ...options,
      effects: ['read'],
    })).rejects.toBeInstanceOf(TBError)
    await expect(decodeToolSearchCursor(cursor, 'calendar', 'keyword', 7, secret))
      .rejects.toBeInstanceOf(TBError)
    const bytes = [...cursor]
    bytes[Math.floor(bytes.length / 2)] = bytes[Math.floor(bytes.length / 2)] === 'A' ? 'B' : 'A'
    await expect(decodeToolSearchCursor(
      bytes.join(''),
      'calendar',
      'keyword',
      7,
      secret,
      options,
    ))
      .rejects.toBeInstanceOf(TBError)

    const cjkQuery = '日'.repeat(TOOL_SEARCH_QUERY_MAX)
    const cjkCursor = await encodeToolSearchCursor(cjkQuery, 'keyword', 7, 42, secret)
    await expect(decodeToolSearchCursor(cjkCursor, cjkQuery, 'keyword', 7, secret))
      .resolves.toBe(42)

    // keyword-v2 改变 offset 排序语义；同一 meta secret 下的 v1 cursor 也必须失效，
    // 避免 rolling deployment 用旧顺序的 offset 续新顺序。
    await expect(decodeToolSearchCursor(
      await legacyV1Cursor(secret),
      'calendar',
      'keyword',
      7,
      secret,
    )).rejects.toBeInstanceOf(TBError)
  })

  it('keeps the adapter mode contract narrow and fails closed at runtime', () => {
    expect(() => assertKeywordToolSearchMode()).not.toThrow()
    expect(() => assertKeywordToolSearchMode({ mode: 'keyword' })).not.toThrow()
    expect(() => assertKeywordToolSearchMode({ mode: 'semantic' })).toThrowError(TBError)
    expect(() => assertKeywordToolSearchMode({ mode: 'regex' } as unknown as ToolSearchOptions))
      .toThrowError(TBError)
  })
})
