import { expect } from 'vitest'
import {
  type MutableSearchIndex,
  TBError,
  TOOL_SEARCH_CANDIDATE_LIMIT,
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

  await index.replace(alpha, [
    { name: 'legacy_calendar', description: 'legacy calendar agenda' },
    richTool,
  ])
  await index.replace(beta, [
    { name: 'weather', description: 'weather forecast endpoint' },
  ])

  await expect(index.search('legacy')).resolves.toMatchObject({
    items: [{ path: alpha, tool: { name: 'legacy_calendar' } }],
  })
  await expect(index.search('管理日')).resolves.toMatchObject({
    items: [{ path: alpha, tool: richTool }],
  })

  const updatedTool: ToolSpec = {
    ...richTool,
    description: 'updated scheduling endpoint',
    confirm: false,
  }
  await index.replace(alpha, [updatedTool])
  await expect(index.search('legacy')).resolves.toEqual({ items: [] })
  await expect(index.search('weather')).resolves.toMatchObject({
    items: [{ path: beta, tool: { name: 'weather' } }],
  })
  await expect(index.search('updated')).resolves.toEqual({
    items: [{ path: alpha, tool: updatedTool }],
  })

  await expect(index.replace(alpha, [updatedTool, updatedTool])).rejects.toBeInstanceOf(TBError)
  await expect(index.search('updated')).resolves.toMatchObject({
    items: [{ path: alpha, tool: { name: 'find_events' } }],
  })

  await index.remove(`${prefix}/missing`)
  await index.remove(`${prefix}/missing`)
  await index.remove(alpha)
  await expect(index.search('updated')).resolves.toEqual({ items: [] })
  await expect(index.search('weather')).resolves.toHaveProperty('items.0.path', beta)

  await index.rebuild([
    {
      path: alpha,
      tool: { name: 'rebuilt_tool', description: 'rebuilt catalog entry' },
    },
  ])
  await expect(index.search('weather')).resolves.toEqual({ items: [] })
  await expect(index.search('rebuilt')).resolves.toMatchObject({
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

  const bulk = Array.from({ length: TOOL_SEARCH_CANDIDATE_LIMIT + 25 }, (_, i) => ({
    path: `${prefix}/bulk/${String(i).padStart(3, '0')}`,
    tool: { name: `bulk_${i}`, description: 'common catalog candidate' },
  }))
  await index.rebuild(bulk)
  const capped = await index.search('catalog')
  expect(capped.items).toHaveLength(TOOL_SEARCH_CANDIDATE_LIMIT)
  expect(capped.items.every(hit => hit.tool.name.startsWith('bulk_'))).toBe(true)

  await index.rebuild([
    {
      path: alpha,
      tool: { name: 'rebuilt_tool', description: 'rebuilt catalog entry' },
    },
  ])
}
