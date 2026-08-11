import { NodeRegistryStore, TOOL_SEARCH_AUDIT_NODE_LIMIT } from '@tool-bridge/core'
import { describe, expect, it } from 'vitest'
import { env, SELF } from 'cloudflare:test'
import {
  D1_SEARCH_COLD_QUERY_MAX,
  D1SearchIndex,
} from '../src/search/d1SearchIndex'
import { verifySearchIndexContract } from '../../core/test/search/searchIndex.fixture'
import { SearchSynchronizer } from '../src/search/synchronizer'
import { KvStateStore } from '../src/kvStateStore'
import { createApp, type Env } from '../src/app'
import { TEST_ADMIN_SK } from './fixtures'

const adminHeaders = {
  'accept': 'application/json',
  'authorization': `Bearer ${TEST_ADMIN_SK}`,
  'content-type': 'application/json',
}
const searchDb = (env as { TB_SEARCH: D1Database }).TB_SEARCH

describe('D1SearchIndex', () => {
  it('keeps the cold 400-document search path within the Free D1 query budget', () => {
    expect(D1_SEARCH_COLD_QUERY_MAX).toBeLessThanOrEqual(50)
  })
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

  it('rebuilds more than 400 small tools without exhausting the query budget', async () => {
    const index = new D1SearchIndex(searchDb)
    const documents = Array.from({ length: 401 }, (_, i) => ({
      path: `contract/d1/large/${i}`,
      tool: {
        name: `large_${i}`,
        description: 'largecatalogunique D1 mutation fixture',
      },
    }))
    await index.rebuild(documents)
    await expect(index.search('largecatalogunique')).resolves.toMatchObject({
      items: expect.arrayContaining([
        expect.objectContaining({ path: 'contract/d1/large/0' }),
      ]),
    })
  })

  it('caps indexed paths without limiting the canonical registry', async () => {
    const index = new D1SearchIndex(searchDb)
    const documents = Array.from({ length: TOOL_SEARCH_AUDIT_NODE_LIMIT }, (_, i) => ({
      path: `contract/d1/cap/${i}`,
      tool: { name: `cap_${i}` },
    }))
    await index.rebuild(documents)
    try {
      await expect(index.replace('contract/d1/cap/overflow', [{ name: 'overflow' }]))
        .rejects.toMatchObject({ code: 'rate_limited' })
    } finally {
      await index.rebuild([])
    }
  })

  it('clears source-only legacy rows and keeps them unseeded until a canonical rebuild', async () => {
    const index = new D1SearchIndex(searchDb)
    await index.initialized()
    await searchDb.batch([
      searchDb.prepare('DELETE FROM tb_search_tools_v2'),
      searchDb.prepare('DELETE FROM tb_search_snapshots_v2'),
      searchDb.prepare('UPDATE tb_search_meta_v2 SET seeded = 0 WHERE singleton = 1'),
      searchDb.prepare(`
        INSERT INTO tb_search_tools_v2(path, name, description, feedback, tool_json)
        VALUES (?, ?, ?, '', ?)
      `).bind(
        'contract/d1/source-only',
        'legacy_source_probe',
        'legacysourceonly',
        JSON.stringify({ name: 'legacy_source_probe', description: 'legacysourceonly' }),
      ),
    ])
    await expect(index.initialized()).resolves.toBe(false)

    await index.replace('contract/d1/source-only', [])
    await expect(index.search('legacysourceonly')).resolves.toMatchObject({ items: [] })

    await searchDb.prepare(`
      INSERT INTO tb_search_tools_v2(path, name, description, feedback, tool_json)
      VALUES (?, ?, ?, '', ?)
    `).bind(
      'contract/d1/source-only',
      'legacy_source_probe',
      'legacysourceonly',
      JSON.stringify({ name: 'legacy_source_probe', description: 'legacysourceonly' }),
    ).run()
    await index.rebuild([])
    await expect(index.initialized()).resolves.toBe(true)
    await expect(index.search('legacysourceonly')).resolves.toMatchObject({ items: [] })
  })

  it('does not let a partial node reconcile claim that the full canonical tree is seeded', async () => {
    const state = new KvStateStore((env as { TB_KV: KVNamespace }).TB_KV)
    const registry = new NodeRegistryStore(state)
    const now = new Date().toISOString()
    const makeNode = (path: string, name: string) => ({
      path,
      kind: 'http' as const,
      description: 'Partial seed fixture',
      config: {
        kind: 'http' as const,
        endpoint: 'https://partial-seed.example.test',
        tools: [{
          name,
          description: `${name} partialseedunique`,
          method: 'GET' as const,
          pathTemplate: '/probe',
        }],
      },
    })
    const alpha = 'search/partial-seed/alpha'
    const beta = 'search/partial-seed/beta'
    await registry.write(makeNode(alpha, 'partial_alpha'), 'system:test', now)
    await registry.write(makeNode(beta, 'partial_beta'), 'system:test', now)
    await searchDb.batch([
      searchDb.prepare('DELETE FROM tb_search_tools_v2'),
      searchDb.prepare('DELETE FROM tb_search_snapshots_v2'),
      searchDb.prepare('UPDATE tb_search_meta_v2 SET seeded = 0 WHERE singleton = 1'),
    ])

    const index = new D1SearchIndex(searchDb)
    const sync = new SearchSynchronizer(state, index)
    const marker = await sync.markNode(alpha)
    await sync.reconcileNode(alpha, { marker })
    await expect(index.initialized()).resolves.toBe(false)

    await sync.ensureReady()
    await expect(index.initialized()).resolves.toBe(true)
    const candidates = await index.search('partialseedunique', { limit: 10 })
    expect(candidates.items.map(item => item.path)).toEqual(expect.arrayContaining([alpha, beta]))
  })

  it('is injected into the real Worker and serves root search over SELF', async () => {
    const path = 'search/wire/d1'
    const tool = {
      name: 'lookup_calendar',
      description: 'Look up calendar appointments and 查询日程日历',
      inputSchema: { type: 'object', properties: { day: { type: 'string' } } },
      effect: 'read',
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
            tools: [{
              name: tool.name,
              description: tool.description,
              inputSchema: tool.inputSchema,
              method: 'GET',
              pathTemplate: '/calendar',
            }],
          },
        },
      }),
    })
    expect(register.status).toBe(200)

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

    const feedback = await SELF.fetch(`https://tb.test/${path}/~feedback`, {
      method: 'POST',
      headers: adminHeaders,
      body: JSON.stringify({
        title: 'Feedback search wire',
        detail: 'feedbackwireunique appears only in node feedback',
      }),
    })
    expect(feedback.status).toBe(200)
    const feedbackSearch = await SELF.fetch('https://tb.test/~search', {
      method: 'POST',
      headers: adminHeaders,
      body: JSON.stringify({ query: 'feedbackwireunique' }),
    })
    expect(feedbackSearch.status).toBe(200)
    await expect(feedbackSearch.json()).resolves.toEqual({ items: [{ path, tool }] })

    const childFeedback = await SELF.fetch(
      `https://tb.test/${path}/${tool.name}/~feedback`,
      {
        method: 'POST',
        headers: adminHeaders,
        body: JSON.stringify({
          title: 'Tool child feedback',
          detail: 'privatechildfeedback must not become a node-level search oracle',
        }),
      },
    )
    expect(childFeedback.status).toBe(200)
    const childSearch = await SELF.fetch('https://tb.test/~search', {
      method: 'POST',
      headers: adminHeaders,
      body: JSON.stringify({ query: 'privatechildfeedback' }),
    })
    expect(childSearch.status).toBe(200)
    await expect(childSearch.json()).resolves.toEqual({ items: [] })

    const bulkTools = Array.from({ length: 125 }, (_, i) => ({
      name: `bulk_${i}`,
      description: 'wirebulkunique candidate',
      method: 'GET' as const,
      pathTemplate: `/bulk/${i}`,
    }))
    const bulkGroups = Array.from({ length: Math.ceil(bulkTools.length / 20) }, (_, i) =>
      bulkTools.slice(i * 20, (i + 1) * 20),
    )
    for (const [groupIndex, tools] of bulkGroups.entries()) {
      const bulkRegister = await SELF.fetch('https://tb.test/system/registry', {
        method: 'POST',
        headers: adminHeaders,
        body: JSON.stringify({
          tool: 'write',
          arguments: {
            path: `search/wire/d1-bulk-${groupIndex}`,
            kind: 'http',
            description: 'Bulk search wire fixture',
            config: {
              kind: 'http',
              endpoint: 'https://bulk.example.test',
              tools,
            },
          },
        }),
      })
      expect(bulkRegister.status).toBe(200)
    }
    const bulkResponse = await SELF.fetch('https://tb.test/~search', {
      method: 'POST',
      headers: adminHeaders,
      body: JSON.stringify({ query: 'wirebulkunique', opts: { limit: 200 } }),
    })
    expect(bulkResponse.status).toBe(200)
    const bulkBody = (await bulkResponse.json()) as { cursor?: string, items: unknown[] }
    expect(bulkBody.items).toHaveLength(125)
    expect(bulkBody.cursor).toBeUndefined()
  })

  it('tracks registry write, update and delete snapshots without stale tools', async () => {
    const path = 'search/wire/registry-lifecycle'
    const config = (name: string, description: string) => ({
      kind: 'http' as const,
      endpoint: 'https://lifecycle.example.test',
      tools: [{ name, description, method: 'GET' as const, pathTemplate: '/probe' }],
    })
    const registryCall = async (tool: string, args: unknown): Promise<Response> => await SELF.fetch(
      'https://tb.test/system/registry',
      {
        method: 'POST',
        headers: adminHeaders,
        body: JSON.stringify({ tool, arguments: args }),
      },
    )
    const search = async (query: string): Promise<{ items: Array<{ path: string }> }> => {
      const response = await SELF.fetch('https://tb.test/~search', {
        method: 'POST',
        headers: adminHeaders,
        body: JSON.stringify({ query }),
      })
      expect(response.status).toBe(200)
      return await response.json() as { items: Array<{ path: string }> }
    }

    expect((await registryCall('write', {
      path,
      kind: 'http',
      description: 'Registry lifecycle fixture',
      config: config('old_probe', 'oldregistryunique'),
    })).status).toBe(200)
    expect((await search('oldregistryunique')).items.map(item => item.path)).toContain(path)

    expect((await registryCall('update', {
      path,
      patch: { config: config('new_probe', 'newregistryunique') },
    })).status).toBe(200)
    expect((await search('oldregistryunique')).items).toEqual([])
    expect((await search('newregistryunique')).items.map(item => item.path)).toContain(path)

    expect((await registryCall('delete', { path })).status).toBe(200)
    expect((await search('newregistryunique')).items).toEqual([])
  })

  it('bulk-reads more than 100 distinct registry paths in one Worker search request', async () => {
    const now = new Date().toISOString()
    const kv = (env as { TB_KV: KVNamespace }).TB_KV
    const documents = Array.from({ length: 125 }, (_, index) => {
      const path = `search/bulk-paths/${String(index).padStart(3, '0')}`
      return {
        path,
        tool: {
          name: `probe_${index}`,
          description: 'distinctpathprobe candidate',
          method: 'GET' as const,
          pathTemplate: '/probe',
        },
      }
    })
    await Promise.all(documents.map(async ({ path, tool }) => await kv.put(
      `node:${path}`,
      JSON.stringify({
        path,
        kind: 'http',
        description: 'Bulk path fixture',
        config: {
          kind: 'http',
          endpoint: 'https://bulk-path.example.test',
          tools: [tool],
        },
        registeredBy: 'system:test',
        createdAt: now,
        updatedAt: now,
      }),
    )))
    await new D1SearchIndex(searchDb).rebuild(documents)

    const response = await SELF.fetch('https://tb.test/~search', {
      method: 'POST',
      headers: adminHeaders,
      body: JSON.stringify({ query: 'distinctpathprobe', opts: { limit: 125 } }),
    })
    expect(response.status).toBe(200)
    const page = await response.json() as { cursor?: string, items: unknown[] }
    expect(page.items).toHaveLength(125)
    expect(page.cursor).toBeUndefined()
  })
})
