import { expect } from 'vitest'
import {
  type MutableSearchIndex,
  TBError,
  TOOL_SEARCH_BATCH_LIMIT,
  type ToolSearchCandidate,
  type ToolSearchOptions,
  type ToolSpec,
} from '../../src'

const richTool: ToolSpec = {
  name: 'find_events',
  description: '管理日程和日历事件',
  effect: 'read',
  confirm: true,
  inputSchema: {
    type: 'object',
    properties: { query: { type: 'string' } },
    required: ['query'],
  },
}

const documentTool: ToolSpec = {
  name: 'create_document',
  description: 'Create document from a workspace template',
  effect: 'write',
}

async function candidatePage(
  index: MutableSearchIndex,
  query: string,
  opts?: ToolSearchOptions,
): Promise<{ cursor?: string, items: ToolSearchCandidate[] }> {
  return await index.search(query, opts)
}

/** D1 与 better-sqlite3 共用的 MutableSearchIndex 一致性断言。 */
export async function verifySearchIndexContract(
  index: MutableSearchIndex,
  prefix: string,
): Promise<void> {
  const alpha = `${prefix}/alpha`
  const beta = `${prefix}/beta`

  expect(index.capabilities).toEqual(['search'])
  await index.rebuild([])
  await index.rebuild([])
  await expect(index.initialized()).resolves.toBe(true)

  await index.replace(alpha, [
    { name: 'legacy_calendar', description: 'legacy calendar agenda' },
    richTool,
    documentTool,
    { name: 'literal_markers', description: 'literal % _ ! \\ markers' },
  ])
  await index.replace(beta, [
    { name: 'weather', description: 'weather forecast endpoint' },
  ])

  await expect(candidatePage(index, 'legacy')).resolves.toMatchObject({
    items: [{ path: alpha, name: 'legacy_calendar' }],
  })
  await expect(candidatePage(index, '管理日')).resolves.toMatchObject({
    items: [{ path: alpha, name: richTool.name }],
  })
  await expect(candidatePage(index, '日程')).resolves.toMatchObject({
    items: [{ path: alpha, name: richTool.name }],
  })
  await expect(candidatePage(index, '日程 日历')).resolves.toMatchObject({
    items: [{ path: alpha, name: richTool.name }],
  })
  await expect(candidatePage(index, 'create document')).resolves.toMatchObject({
    items: [{ path: alpha, name: documentTool.name }],
  })
  await expect(candidatePage(index, '日程 calendar')).resolves.toEqual({ items: [] })
  await expect(candidatePage(index, 'AI calendar')).resolves.toEqual({ items: [] })
  const longMixedTerm = `AI ${'calendar'.repeat(12)}`
  await expect(candidatePage(index, longMixedTerm)).resolves.toEqual({ items: [] })
  await expect(candidatePage(index, 'LE')).resolves.toMatchObject({
    items: [{ path: alpha, name: 'legacy_calendar' }],
  })
  for (const literal of ['%', '!', '\\']) {
    await expect(candidatePage(index, literal)).resolves.toMatchObject({
      items: [{ path: alpha, name: 'literal_markers' }],
    })
  }

  const largePath = `${prefix}/large-catalog`
  const largeDescription = `largecatalogdescription ${'长描述'.repeat(2_000)}`
  await index.replace(largePath, Array.from({ length: 8 }, (_, index) => ({
    name: `large_catalog_${index}`,
    description: largeDescription,
    inputSchema: { type: 'object', properties: { value: { type: 'string' } } },
  })))
  await expect(candidatePage(index, 'largecatalogdescription')).resolves.toMatchObject({
    items: Array.from({ length: 8 }, (_, index) => ({
      path: largePath,
      name: `large_catalog_${index}`,
    })),
  })
  await index.remove(largePath)

  const updatedTool: ToolSpec = {
    ...richTool,
    description: 'updated scheduling endpoint',
    confirm: false,
  }
  await index.replace(alpha, [updatedTool])
  await expect(candidatePage(index, 'legacy')).resolves.toEqual({ items: [] })
  await expect(candidatePage(index, 'weather')).resolves.toMatchObject({
    items: [{ path: beta, name: 'weather' }],
  })
  await expect(candidatePage(index, 'updated')).resolves.toMatchObject({
    items: [{ path: alpha, name: updatedTool.name }],
  })

  await expect(index.replace(alpha, [updatedTool, updatedTool])).rejects.toBeInstanceOf(TBError)
  await expect(candidatePage(index, 'updated')).resolves.toMatchObject({
    items: [{ path: alpha, name: 'find_events' }],
  })

  await index.remove(`${prefix}/missing`)
  await index.remove(alpha)
  await expect(candidatePage(index, 'updated')).resolves.toEqual({ items: [] })
  await expect(candidatePage(index, 'weather')).resolves.toHaveProperty('items.0.path', beta)

  await index.rebuild([
    {
      path: alpha,
      tool: { name: 'rebuilt_tool', description: 'rebuilt catalog entry' },
    },
  ])
  await expect(candidatePage(index, 'weather')).resolves.toEqual({ items: [] })
  await expect(candidatePage(index, 'rebuilt')).resolves.toMatchObject({
    items: [{ path: alpha, name: 'rebuilt_tool' }],
  })
  await expect(index.search('rebuilt', { mode: 'semantic' })).rejects.toMatchObject({
    code: 'invalid_argument',
  })
  await expect(index.search('rebuilt', { mode: 'regex' } as unknown as ToolSearchOptions))
    .rejects.toMatchObject({ code: 'invalid_argument' })
  await expect(index.search('rebuilt\0private')).rejects.toMatchObject({
    code: 'invalid_argument',
  })

  await index.rebuild([
    {
      path: `${prefix}/rank/name`,
      tool: { name: 'calendar', description: 'ranking fixture' },
    },
    {
      path: `${prefix}/rank/description`,
      tool: { name: 'description_match', description: 'calendar ranking fixture' },
    },
    {
      path: `${prefix}/rank/feedback`,
      tool: { name: 'feedback_match', description: 'ranking fixture' },
      feedback: 'calendar feedback fixture',
    },
  ])
  const weighted = await candidatePage(index, 'calendar')
  expect(weighted.items.map(item => item.path)).toEqual([
    `${prefix}/rank/name`,
    `${prefix}/rank/description`,
    `${prefix}/rank/feedback`,
  ])

  await index.rebuild([
    {
      path: `${prefix}/short/name`,
      tool: { name: '日程', description: '短词排序样例' },
    },
    {
      path: `${prefix}/short/description`,
      tool: { name: 'short_description', description: '日程短词排序样例' },
    },
    {
      path: `${prefix}/short/feedback`,
      tool: { name: 'short_feedback', description: '短词排序样例' },
      feedback: '日程反馈样例',
    },
  ])
  const shortWeighted = await candidatePage(index, '日程')
  expect(shortWeighted.items.map(item => item.path)).toEqual([
    `${prefix}/short/name`,
    `${prefix}/short/description`,
    `${prefix}/short/feedback`,
  ])

  const bulk = Array.from({ length: TOOL_SEARCH_BATCH_LIMIT + 25 }, (_, i) => ({
    path: `${prefix}/bulk/${String(i).padStart(3, '0')}`,
    tool: { name: `bulk_${i}`, description: 'common catalog candidate' },
  }))
  await index.rebuild(bulk)
  const first = await index.search('catalog', { limit: 200 })
  expect(first.items).toHaveLength(TOOL_SEARCH_BATCH_LIMIT)
  expect(first.cursor).toBeTypeOf('string')
  await index.rebuild(bulk)
  await index.remove(`${prefix}/missing`)
  const second = await index.search('catalog', { cursor: first.cursor, limit: 200 })
  expect(second.items).toHaveLength(25)
  expect(second.cursor).toBeUndefined()
  const names = [...first.items, ...second.items].map(candidate => candidate.name)
  expect(new Set(names).size).toBe(bulk.length)

  const stale = first.cursor
  await index.replace(`${prefix}/fresh`, [{ name: 'fresh', description: 'catalog fresh' }])
  await expect(index.search('catalog', { cursor: stale })).rejects.toMatchObject({
    code: 'invalid_argument',
  })
  await index.removePrefix(`${prefix}/bulk`)
  await expect(candidatePage(index, 'catalog')).resolves.toMatchObject({
    items: [{ path: `${prefix}/fresh` }],
  })

  await index.rebuild([
    {
      path: alpha,
      tool: { name: 'rebuilt_tool', description: 'rebuilt catalog entry' },
    },
  ])
}
