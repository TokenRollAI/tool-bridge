import { TOOL_SEARCH_CANDIDATE_LIMIT } from '@tool-bridge/core'
import { describe, expect, it } from 'vitest'
import { env, SELF } from 'cloudflare:test'
import { verifySearchIndexContract } from '../../core/test/search/searchIndex.fixture'
import { D1_SEARCH_MUTATION_LIMIT, D1SearchIndex } from '../src/search/d1SearchIndex'
import { createApp, type Env } from '../src/app'
import { TEST_ADMIN_SK } from './fixtures'

const adminHeaders = {
  'accept': 'application/json',
  'authorization': `Bearer ${TEST_ADMIN_SK}`,
  'content-type': 'application/json',
}
const searchDb = (env as { TB_SEARCH: D1Database }).TB_SEARCH

describe('D1SearchIndex', () => {
  it('does not advertise search when a library host omits the optional D1 binding', async () => {
    const withoutSearch = new Proxy(env as unknown as Env, {
      get(target, property, receiver) {
        return property === 'TB_SEARCH' ? undefined : Reflect.get(target, property, receiver)
      },
    })
    const response = await createApp().fetch(
      new Request('https://tb.test/~describe', { headers: adminHeaders }),
      withoutSearch,
    )
    expect(response.status).toBe(404)
  })

  it('satisfies the shared FTS5/trigram mutation contract', async () => {
    await verifySearchIndexContract(new D1SearchIndex(searchDb), 'contract/d1')
  })

  it('fails before D1 mutation when a snapshot exceeds the bounded batch budget', async () => {
    const index = new D1SearchIndex(searchDb)
    const tools = Array.from({ length: D1_SEARCH_MUTATION_LIMIT + 1 }, (_, i) => ({
      name: `oversized_${i}`,
      description: 'oversized D1 mutation fixture',
    }))
    await expect(index.replace('contract/d1/oversized', tools)).rejects.toMatchObject({
      code: 'invalid_argument',
    })
  })

  it('is injected into the real Worker and serves root search over SELF', async () => {
    const path = 'search/wire/d1'
    const tool = {
      name: 'lookup_calendar',
      description: 'Look up calendar appointments and 查询日程日历',
      inputSchema: { type: 'object', properties: { day: { type: 'string' } } },
    }
    const register = await SELF.fetch('https://tb.test/system/registry', {
      method: 'POST',
      headers: adminHeaders,
      body: JSON.stringify({
        tool: 'write',
        arguments: {
          path,
          kind: 'http',
          description: 'Search wire fixture',
          config: {
            kind: 'http',
            endpoint: 'https://calendar.example.test',
            tools: [],
          },
        },
      }),
    })
    expect(register.status).toBe(200)

    const index = new D1SearchIndex(searchDb)
    await index.rebuild([{ path, tool }])

    const describe = await SELF.fetch('https://tb.test/~describe', {
      headers: adminHeaders,
    })
    expect(describe.status).toBe(200)
    await expect(describe.json()).resolves.toEqual({
      kind: 'directory',
      capabilities: ['search'],
    })

    const response = await SELF.fetch('https://tb.test/~search', {
      method: 'POST',
      headers: adminHeaders,
      body: JSON.stringify({ query: 'calendar' }),
    })
    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ items: [{ path, tool }] })

    const shortResponse = await SELF.fetch('https://tb.test/~search', {
      method: 'POST',
      headers: adminHeaders,
      body: JSON.stringify({ query: '日程' }),
    })
    expect(shortResponse.status).toBe(200)
    await expect(shortResponse.json()).resolves.toEqual({ items: [{ path, tool }] })

    const bulkTools = Array.from({ length: TOOL_SEARCH_CANDIDATE_LIMIT + 25 }, (_, i) => ({
      name: `bulk_${i}`,
      description: 'common catalog wire candidate',
    }))
    await index.rebuild(bulkTools.map(bulkTool => ({ path, tool: bulkTool })))
    const bulkResponse = await SELF.fetch('https://tb.test/~search', {
      method: 'POST',
      headers: adminHeaders,
      body: JSON.stringify({ query: 'catalog' }),
    })
    expect(bulkResponse.status).toBe(200)
    const bulkBody = (await bulkResponse.json()) as { items: unknown[] }
    expect(bulkBody.items).toHaveLength(TOOL_SEARCH_CANDIDATE_LIMIT)
  })
})
