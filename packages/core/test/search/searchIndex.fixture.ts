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
  const partialCjk = await candidatePage(index, '日程 calendar')
  expect(partialCjk.items.map(item => item.name)).toEqual([
    'legacy_calendar',
    richTool.name,
  ])
  await expect(candidatePage(index, 'AI calendar')).resolves.toMatchObject({
    items: [{ path: alpha, name: 'legacy_calendar' }],
  })
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
      tool: { name: 'inbox', description: 'ranking fixture' },
    },
    {
      path: `${prefix}/inbox`,
      tool: { name: 'path_match', description: 'ranking fixture' },
    },
    {
      path: `${prefix}/rank/description`,
      tool: { name: 'description_match', description: 'inbox ranking fixture' },
    },
    {
      path: `${prefix}/rank/feedback`,
      tool: { name: 'feedback_match', description: 'ranking fixture' },
      feedback: 'inbox feedback fixture',
    },
  ])
  const weighted = await candidatePage(index, 'inbox')
  expect(weighted.items.map(item => item.path)).toEqual([
    `${prefix}/rank/name`,
    `${prefix}/inbox`,
    `${prefix}/rank/description`,
    `${prefix}/rank/feedback`,
  ])

  // effect 只来自显式 ToolSpec.effect；过滤发生在候选 LIMIT 前，read 不会把
  // 缺标记但 prose 含 read 的 unknown 工具带进来。
  await index.rebuild([
    {
      path: `${prefix}/effects/write`,
      tool: { name: 'effectprobe', description: 'highest field score', effect: 'write' },
    },
    {
      path: `${prefix}/effects/read`,
      tool: { name: 'read_effect', description: 'effectprobe', effect: 'read' },
    },
    {
      path: `${prefix}/effects/destructive`,
      tool: {
        name: 'destructive_effect',
        description: 'effectprobe',
        effect: 'destructive',
      },
    },
    {
      path: `${prefix}/effects/unknown`,
      tool: { name: 'unknown_effect', description: 'effectprobe safe read operation' },
    },
  ])
  const readOnly = await candidatePage(index, 'effectprobe', {
    effects: ['read'],
    limit: 1,
  })
  expect(readOnly.items.map(item => item.name)).toEqual(['read_effect'])
  expect(readOnly.cursor).toBeUndefined()
  const unknownOnly = await candidatePage(index, 'effectprobe', { effects: ['unknown'] })
  expect(unknownOnly.items.map(item => item.name)).toEqual(['unknown_effect'])

  const effectPage = await candidatePage(index, 'effectprobe', {
    effects: ['unknown', 'read', 'read'],
    limit: 1,
  })
  expect(effectPage.items).toHaveLength(1)
  expect(effectPage.cursor).toBeTypeOf('string')
  const effectNext = await candidatePage(index, 'effectprobe', {
    cursor: effectPage.cursor,
    effects: ['read', 'unknown'],
    limit: 1,
  })
  expect(new Set([...effectPage.items, ...effectNext.items].map(item => item.name))).toEqual(
    new Set(['read_effect', 'unknown_effect']),
  )
  await expect(index.search('effectprobe', {
    cursor: effectPage.cursor,
    effects: ['write'],
    limit: 1,
  })).rejects.toMatchObject({ code: 'invalid_argument' })

  // Coverage 是字典序第一维：setter 在 name/path 上的旧字段分更高，但只覆盖
  // home+temperature；read tool 覆盖四个原始 terms，必须稳定排在前面。
  await index.rebuild([
    {
      path: `${prefix}/home/home-assistant`,
      tool: {
        name: 'hass_climate_set_temperature',
        description: 'Set a target temperature',
      },
    },
    {
      path: `${prefix}/home/home-assistant`,
      tool: {
        name: 'get_live_context',
        description: 'Read current Home Assistant entity and temperature sensor state',
      },
    },
    {
      path: `${prefix}/device/phone`,
      tool: {
        name: 'location_current',
        description: 'Read current phone location',
      },
    },
  ])
  const coverageFirst = await candidatePage(index, 'read current home temperature', { limit: 3 })
  expect(coverageFirst.items.map(item => item.name)).toEqual(['get_live_context'])
  expect(coverageFirst.cursor).toBeTypeOf('string')
  expect(coverageFirst.items.map(item => ({
    coverage: item.coverage,
    matchedTermCount: item.matchedTermCount,
    totalTermCount: item.totalTermCount,
  }))).toEqual([
    { coverage: 1, matchedTermCount: 4, totalTermCount: 4 },
  ])
  const lowerCoverage = await candidatePage(index, 'read current home temperature', {
    cursor: coverageFirst.cursor,
    limit: 3,
  })
  expect(lowerCoverage.items.map(item => item.name)).toEqual([
    'hass_climate_set_temperature',
    'location_current',
  ])
  expect(lowerCoverage.items.map(item => item.coverage)).toEqual([0.5, 0.5])
  expect(lowerCoverage.cursor).toBeUndefined()

  const allTerms = await candidatePage(index, 'read current home temperature', {
    matching: 'all',
  })
  expect(allTerms.items.map(item => item.name)).toEqual(['get_live_context'])
  expect(allTerms.cursor).toBeUndefined()
  const coverageFloor = await candidatePage(index, 'read current home temperature', {
    minCoverage: 0.75,
  })
  expect(coverageFloor.items.map(item => item.name)).toEqual(['get_live_context'])
  expect(coverageFloor.cursor).toBeUndefined()
  await expect(index.search('read current home temperature', {
    cursor: coverageFirst.cursor,
    matching: 'all',
  })).rejects.toMatchObject({ code: 'invalid_argument' })
  await expect(index.search('read current home temperature', {
    cursor: coverageFirst.cursor,
    minCoverage: 0.75,
  })).rejects.toMatchObject({ code: 'invalid_argument' })
  await expect(index.search('read current home temperature', {
    cursor: coverageFirst.cursor,
    pathPrefix: `${prefix}/home`,
  })).rejects.toMatchObject({ code: 'invalid_argument' })
  await expect(index.search('read current home temperature', {
    matching: 'all',
    minCoverage: 0.5,
  })).rejects.toMatchObject({ code: 'invalid_argument' })

  await index.rebuild([
    {
      path: `${prefix}/home/home-assistant`,
      tool: { name: 'hass_turn_on', description: 'Turn on a home light' },
    },
    {
      path: `${prefix}/home/home-assistant`,
      tool: { name: 'hass_turn_off', description: 'Turn off a home light' },
    },
    {
      path: `${prefix}/home/home-assistant`,
      tool: { name: 'hass_light_set', description: 'Set a home light' },
    },
    {
      path: `${prefix}/todo`,
      tool: { name: 'todo_get_items', description: 'Read every todo item' },
    },
  ])
  const turnOn = await candidatePage(index, 'turn on home light')
  expect(turnOn.items.map(item => item.name)).toEqual(['hass_turn_on'])
  expect(turnOn.items[0]).toMatchObject({
    coverage: 1,
    matchedTermCount: 4,
    totalTermCount: 4,
  })

  await index.rebuild([
    {
      path: `${prefix}/home/home-assistant`,
      tool: {
        name: 'hass_cancel_all_timers',
        description: 'Cancel every timer at home',
      },
    },
    {
      path: `${prefix}/home/home-assistant`,
      tool: { name: 'get_date_time', description: 'Read date and time at home' },
    },
    {
      path: `${prefix}/runtime`,
      tool: { name: 'cancel_run', description: 'Cancel one runtime operation' },
    },
  ])
  const cancelTimers = await candidatePage(index, 'cancel every timer at home')
  expect(cancelTimers.items.map(item => item.name)).toEqual(['hass_cancel_all_timers'])
  expect(cancelTimers.items[0]).toMatchObject({
    coverage: 1,
    matchedTermCount: 5,
    totalTermCount: 5,
  })

  await index.rebuild([
    {
      path: `${prefix}/scope/home`,
      tool: { name: 'prefix_exact', description: 'scoped marker' },
    },
    {
      path: `${prefix}/scope/home/child`,
      tool: { name: 'prefix_child', description: 'scoped marker' },
    },
    {
      path: `${prefix}/scope/homebrew`,
      tool: { name: 'prefix_collision', description: 'scoped marker' },
    },
  ])
  const scoped = await candidatePage(index, 'scoped marker', {
    matching: 'all',
    pathPrefix: `/${prefix}/scope/home/`,
  })
  expect(scoped.items.map(item => item.path)).toEqual([
    `${prefix}/scope/home`,
    `${prefix}/scope/home/child`,
  ])

  await index.rebuild([
    {
      path: `${prefix}/cjk/exact`,
      tool: { name: 'exact_match', description: '支持发送信件到指定收件人' },
    },
    {
      path: `${prefix}/cjk/bigram`,
      tool: { name: 'bigram_match', description: '支持发送通知到指定收件人' },
    },
    {
      path: `${prefix}/cjk/single`,
      tool: { name: 'single_match', description: '保存到设备的本地信箱' },
    },
  ])
  const cjkTiers = await candidatePage(index, '发送信件')
  expect(cjkTiers.items.map(item => item.path)).toEqual([
    `${prefix}/cjk/exact`,
    `${prefix}/cjk/bigram`,
    `${prefix}/cjk/single`,
  ])
  expect(cjkTiers.items.map(item => ({
    coverage: item.coverage,
    matchedTermCount: item.matchedTermCount,
    totalTermCount: item.totalTermCount,
  }))).toEqual(Array.from(
    { length: 3 },
    () => ({ coverage: 1, matchedTermCount: 1, totalTermCount: 1 }),
  ))

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
  const repeatedTerm = await index.search('catalog CATALOG catalog', { limit: 1 })
  expect(repeatedTerm.items[0]).toMatchObject({
    coverage: 1,
    matchedTermCount: 1,
    totalTermCount: 1,
  })
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
