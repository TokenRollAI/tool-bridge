import { expect } from 'vitest'
import {
  type MutableSearchIndex,
  TBError,
  TOOL_SEARCH_BATCH_LIMIT,
  type ToolSearchHit,
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

async function hydratedPage(
  index: MutableSearchIndex,
  query: string,
  opts?: ToolSearchOptions,
): Promise<{ cursor?: string, items: ToolSearchHit[] }> {
  const candidates = await index.search(query, opts)
  const hydrated = await index.hydrate(candidates.items)
  expect(hydrated.consumed).toBe(candidates.items.length)
  return candidates.cursor === undefined
    ? { items: hydrated.hits }
    : { items: hydrated.hits, cursor: candidates.cursor }
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

  await expect(hydratedPage(index, 'legacy')).resolves.toMatchObject({
    items: [{ path: alpha, tool: { name: 'legacy_calendar' } }],
  })
  await expect(hydratedPage(index, '管理日')).resolves.toMatchObject({
    items: [{ path: alpha, tool: richTool }],
  })
  await expect(hydratedPage(index, '日程')).resolves.toMatchObject({
    items: [{ path: alpha, tool: richTool }],
  })
  await expect(hydratedPage(index, '日程 日历')).resolves.toMatchObject({
    items: [{ path: alpha, tool: richTool }],
  })
  await expect(hydratedPage(index, 'create document')).resolves.toMatchObject({
    items: [{ path: alpha, tool: documentTool }],
  })
  await expect(hydratedPage(index, '日程 calendar')).resolves.toEqual({ items: [] })
  await expect(hydratedPage(index, 'AI calendar')).resolves.toEqual({ items: [] })
  const longMixedTerm = `AI ${'calendar'.repeat(12)}`
  await expect(hydratedPage(index, longMixedTerm)).resolves.toEqual({ items: [] })
  await expect(hydratedPage(index, 'LE')).resolves.toMatchObject({
    items: [{ path: alpha, tool: { name: 'legacy_calendar' } }],
  })
  for (const literal of ['%', '!', '\\']) {
    await expect(hydratedPage(index, literal)).resolves.toMatchObject({
      items: [{ path: alpha, tool: { name: 'literal_markers' } }],
    })
  }

  const updatedTool: ToolSpec = {
    ...richTool,
    description: 'updated scheduling endpoint',
    confirm: false,
  }
  await index.replace(alpha, [updatedTool])
  await expect(hydratedPage(index, 'legacy')).resolves.toEqual({ items: [] })
  await expect(hydratedPage(index, 'weather')).resolves.toMatchObject({
    items: [{ path: beta, tool: { name: 'weather' } }],
  })
  await expect(hydratedPage(index, 'updated')).resolves.toEqual({
    items: [{ path: alpha, tool: updatedTool }],
  })

  await expect(index.replace(alpha, [updatedTool, updatedTool])).rejects.toBeInstanceOf(TBError)
  await expect(hydratedPage(index, 'updated')).resolves.toMatchObject({
    items: [{ path: alpha, tool: { name: 'find_events' } }],
  })

  await index.remove(`${prefix}/missing`)
  await index.remove(alpha)
  await expect(hydratedPage(index, 'updated')).resolves.toEqual({ items: [] })
  await expect(hydratedPage(index, 'weather')).resolves.toHaveProperty('items.0.path', beta)

  await index.rebuild([
    {
      path: alpha,
      tool: { name: 'rebuilt_tool', description: 'rebuilt catalog entry' },
    },
  ])
  await expect(hydratedPage(index, 'weather')).resolves.toEqual({ items: [] })
  await expect(hydratedPage(index, 'rebuilt')).resolves.toMatchObject({
    items: [{ path: alpha, tool: { name: 'rebuilt_tool' } }],
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
  const weighted = await hydratedPage(index, 'calendar')
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
  const shortWeighted = await hydratedPage(index, '日程')
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
  const names = [
    ...(await index.hydrate(first.items)).hits,
    ...(await index.hydrate(second.items)).hits,
  ].map(hit => hit.tool.name)
  expect(new Set(names).size).toBe(bulk.length)

  const stale = first.cursor
  await index.replace(`${prefix}/fresh`, [{ name: 'fresh', description: 'catalog fresh' }])
  await expect(index.search('catalog', { cursor: stale })).rejects.toMatchObject({
    code: 'invalid_argument',
  })
  await index.removePrefix(`${prefix}/bulk`)
  await expect(hydratedPage(index, 'catalog')).resolves.toMatchObject({
    items: [{ path: `${prefix}/fresh` }],
  })

  await index.rebuild([
    {
      path: alpha,
      tool: { name: 'rebuilt_tool', description: 'rebuilt catalog entry' },
    },
  ])
}
