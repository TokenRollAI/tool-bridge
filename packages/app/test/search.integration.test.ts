import {
  MemoryStateStore,
  NodeRegistryStore,
  type SearchIndex,
  SecretStoreImpl,
  SKRegistryStore,
} from '@tool-bridge/core'
import { describe, expect, it, vi } from 'vitest'
import { TEST_ADMIN_SK, TEST_ENCRYPTION_KEY } from './fixtures'
import { createTbApp, runBootstrap } from '../src/index'

const adminHeaders = {
  'accept': 'application/json',
  'authorization': `Bearer ${TEST_ADMIN_SK}`,
  'content-type': 'application/json',
}

function emptySearchIndex(
  capabilities: SearchIndex['capabilities'] = ['search'],
): SearchIndex & { search: ReturnType<typeof vi.fn> } {
  return {
    capabilities,
    cursorFor: async (_query, candidate) => `c${candidate.resumeOffset}`,
    search: vi.fn(async () => ({ items: [] })),
  }
}

async function appWith(search?: SearchIndex): Promise<{
  app: ReturnType<typeof createTbApp>
  state: MemoryStateStore
}> {
  const state = new MemoryStateStore()
  await runBootstrap(state, { adminSk: TEST_ADMIN_SK, requireAdminSk: true })
  return {
    app: createTbApp({
      allowInsecureHttp: false,
      remote: { allowlist: [], maxHops: 4, allowInsecure: false },
      search,
      secrets: new SecretStoreImpl(state, TEST_ENCRYPTION_KEY),
      state,
      version: 'test',
    }),
    state,
  }
}

async function postSearch(
  app: ReturnType<typeof createTbApp>,
  body: unknown,
  sk: string | null = TEST_ADMIN_SK,
): Promise<Response> {
  return app.request(
    new Request('https://tb.test/~search', {
      method: 'POST',
      headers: sk === null
        ? { 'accept': 'application/json', 'content-type': 'application/json' }
        : {
            ...adminHeaders,
            authorization: `Bearer ${sk}`,
          },
      body: new Blob([JSON.stringify(body)], { type: 'application/json' }),
    }),
  )
}

async function postRegistry(
  app: ReturnType<typeof createTbApp>,
  args: Record<string, unknown>,
): Promise<Response> {
  return await app.request(new Request('https://tb.test/system/registry/write', {
    method: 'POST',
    headers: adminHeaders,
    body: new Blob([JSON.stringify(args)], {
      type: 'application/json',
    }),
  }))
}

describe('global ~search protocol', () => {
  it('does not impose search-only capacity limits when no index is injected', async () => {
    const { app, state } = await appWith()
    const path = `${Array.from({ length: 40 }, () => 'deep').join('/')}/provider`
    const response = await postRegistry(app, {
      path,
      kind: 'http',
      description: 'Canonical capacity remains independent from optional search',
      config: {
        kind: 'http',
        endpoint: 'https://capacity.example.test',
        tools: Array.from({ length: 21 }, (_, index) => ({
          name: `tool_${index}`,
          method: 'GET',
          pathTemplate: `/tool/${index}`,
        })),
      },
    })
    expect(response.status).toBe(200)
    expect(await state.get(`node:${path}`)).not.toBeNull()
  })

  it('keeps root describe and search absent without a declared implementation', async () => {
    const { app } = await appWith()

    const describeResponse = await app.request('https://tb.test/~describe', {
      headers: adminHeaders,
    })
    expect(describeResponse.status).toBe(404)
    expect((await postSearch(app, { query: 'weather' })).status).toBe(404)
  })

  it('authenticates before dispatching to the injected index', async () => {
    const index = emptySearchIndex()
    const { app } = await appWith(index)

    const response = await postSearch(app, { query: 'weather' }, null)

    expect(response.status).toBe(401)
    expect(index.search).not.toHaveBeenCalled()
  })

  it('describes keyword search and returns the root-only page contract', async () => {
    const search = vi.fn(async () => ({
      items: [
        {
          name: 'forecast',
          path: 'providers/weather',
          ref: 'visible',
          resumeOffset: 1,
          revision: 1,
        },
        {
          name: 'internal_forecast',
          path: 'providers/weather',
          ref: 'hidden',
          resumeOffset: 2,
          revision: 1,
        },
      ],
    }))
    const { app, state } = await appWith({
      capabilities: ['search'],
      cursorFor: async (_query, candidate) => `c${candidate.resumeOffset}`,
      search,
    })
    await new NodeRegistryStore(state).write(
      {
        path: 'providers/weather',
        kind: 'http',
        description: 'Weather tools',
        config: {
          kind: 'http',
          endpoint: 'https://weather.example.test',
          tools: [
            {
              name: 'forecast',
              description: 'Get a weather forecast',
              inputSchema: { type: 'object' },
              method: 'GET',
              pathTemplate: '/forecast',
            },
            {
              name: 'internal_forecast',
              description: 'Hidden upstream tool',
              method: 'GET',
              pathTemplate: '/internal',
            },
          ],
        },
        virtualize: { hide: ['internal_forecast'], prefix: 'weather__' },
      },
      'system:test',
      new Date().toISOString(),
    )

    const describeResponse = await app.request('https://tb.test/~describe', {
      headers: adminHeaders,
    })
    expect(describeResponse.status).toBe(200)
    await expect(describeResponse.json()).resolves.toEqual({
      kind: 'directory',
      capabilities: ['search'],
    })

    const response = await postSearch(app, {
      query: '  weather  ',
      opts: { mode: 'keyword' },
    })
    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      items: [
        {
          path: 'providers/weather',
          tool: {
            name: 'weather__forecast',
            description: 'Get a weather forecast',
            effect: 'read',
            inputSchema: { type: 'object' },
          },
        },
      ],
    })
    expect(search).toHaveBeenCalledOnce()
    expect(search).toHaveBeenCalledWith('weather', { limit: 100, mode: 'keyword' })

    const { secret: readOnlySk } = await new SKRegistryStore(state).write(
      {
        owner: 'agent:search-read-only',
        scopes: [{ pattern: 'providers/weather', actions: ['read'] }],
      },
      new Date().toISOString(),
    )
    const narrowedResponse = await postSearch(app, { query: 'weather' }, readOnlySk)
    expect(narrowedResponse.status).toBe(200)
    await expect(narrowedResponse.json()).resolves.toEqual({ items: [] })

    const pathLocalResponse = await app.request(new Request(
      'https://tb.test/providers/weather/~search', {
        method: 'POST',
        headers: adminHeaders,
        body: new Blob([JSON.stringify({ query: 'weather' })], { type: 'application/json' }),
      },
    ))
    expect(pathLocalResponse.status).toBe(404)

    const encodedPathLocalResponse = await app.request(new Request(
      'https://tb.test/providers/weather/%7Esearch', {
        method: 'POST',
        headers: adminHeaders,
        body: new Blob([JSON.stringify({ query: 'weather' })], { type: 'application/json' }),
      },
    ))
    expect(encodedPathLocalResponse.status).toBe(404)
  })

  it('rejects unavailable and unknown modes before querying the index', async () => {
    const index = emptySearchIndex()
    const { app } = await appWith(index)

    const semantic = await postSearch(app, {
      query: 'weather',
      opts: { mode: 'semantic' },
    })
    expect(semantic.status).toBe(400)
    await expect(semantic.json()).resolves.toMatchObject({
      code: 'invalid_argument',
      message: expect.stringContaining('search:semantic'),
    })

    const unknown = await postSearch(app, {
      query: 'weather',
      opts: { mode: 'regex' },
    })
    expect(unknown.status).toBe(400)

    const invalidLimit = await postSearch(app, {
      query: 'weather',
      opts: { limit: '10' },
    })
    expect(invalidLimit.status).toBe(400)
    expect((await postSearch(app, { query: 'weather', opts: { cursor: 3 } })).status).toBe(400)
    expect((await postSearch(app, { query: 'weather', opts: { filter: {} } })).status).toBe(400)

    expect((await postSearch(app, { query: '   ' })).status).toBe(400)
    expect((await postSearch(app, [])).status).toBe(400)
    expect(index.search).not.toHaveBeenCalled()
  })

  it('accepts semantic mode only when the implementation declares it', async () => {
    const index = emptySearchIndex(['search', 'search:semantic'])
    const { app } = await appWith(index)

    const response = await postSearch(app, {
      query: 'weather',
      opts: { mode: 'semantic' },
    })

    expect(response.status).toBe(200)
    expect(index.search).toHaveBeenCalledWith('weather', { limit: 100, mode: 'semantic' })
  })

  it('over-fetches with bulk registry reads, fills the scoped page and resumes raw cursor', async () => {
    const candidates = [
      ...Array.from({ length: 125 }, (_, i) => ({ path: `denied/${i}`, name: `denied_${i}` })),
      ...Array.from({ length: 175 }, (_, i) => ({ path: `allowed/${i}`, name: `allowed_${i}` })),
    ].map((candidate, index) => ({
      ...candidate,
      ref: String(index),
      resumeOffset: index + 1,
      revision: 1,
    }))
    const search = vi.fn(async (_query: string, opts?: { cursor?: string, limit?: number }) => {
      const offset = opts?.cursor === undefined ? 0 : Number(opts.cursor.slice(1))
      const limit = opts?.limit ?? 50
      const items = candidates.slice(offset, offset + limit)
      const end = offset + items.length
      return end < candidates.length ? { items, cursor: `c${end}` } : { items }
    })
    const { app, state } = await appWith({
      capabilities: ['search'],
      cursorFor: async (_query, candidate) => `c${candidate.resumeOffset}`,
      search,
    })
    const registry = new NodeRegistryStore(state)
    for (const candidate of candidates) {
      await registry.write(
        {
          path: candidate.path,
          kind: 'http',
          description: 'Search scope fixture',
          config: {
            kind: 'http',
            endpoint: 'https://scope.example.test',
            tools: [{
              name: candidate.name,
              description: 'scoped candidate',
              method: 'GET',
              pathTemplate: '/candidate',
            }],
          },
        },
        'system:test',
        new Date().toISOString(),
      )
    }
    const { secret } = await new SKRegistryStore(state).write(
      {
        owner: 'agent:scoped-search',
        scopes: [{ pattern: 'allowed/**', actions: ['read', 'call'] }],
      },
      new Date().toISOString(),
    )
    const getMany = vi.spyOn(state, 'getMany')

    const first = await postSearch(app, { query: 'candidate', opts: { limit: 150 } }, secret)
    expect(first.status).toBe(200)
    const firstPage = (await first.json()) as { cursor?: string, items: Array<{ path: string }> }
    expect(firstPage.items).toHaveLength(150)
    expect(firstPage.items[0]?.path).toBe('allowed/0')
    expect(firstPage.items[149]?.path).toBe('allowed/149')
    expect(firstPage.cursor).toBe('c275')
    expect(getMany).toHaveBeenCalledTimes(3)

    const second = await postSearch(
      app,
      { query: 'candidate', opts: { limit: 150, cursor: firstPage.cursor } },
      secret,
    )
    expect(second.status).toBe(200)
    const secondPage = (await second.json()) as { cursor?: string, items: Array<{ path: string }> }
    expect(secondPage.items).toHaveLength(25)
    expect(secondPage.items[0]?.path).toBe('allowed/150')
    expect(secondPage.items[24]?.path).toBe('allowed/174')
    expect(secondPage.cursor).toBeUndefined()
    expect(getMany).toHaveBeenCalledTimes(4)
  })

  it('does not expose a continuation cursor when every raw match is denied', async () => {
    const candidates = Array.from({ length: 500 }, (_, index) => ({
      name: `private_${index}`,
      path: `private/${index}`,
      ref: String(index),
      resumeOffset: index + 1,
      revision: 1,
    }))
    const search = vi.fn(async (_query: string, opts?: { cursor?: string, limit?: number }) => {
      const offset = opts?.cursor === undefined ? 0 : Number(opts.cursor.slice(1))
      const items = candidates.slice(offset, offset + (opts?.limit ?? 50))
      const end = offset + items.length
      return end < candidates.length ? { items, cursor: `c${end}` } : { items }
    })
    const { app, state } = await appWith({
      capabilities: ['search'],
      cursorFor: async (_query, candidate) => `c${candidate.resumeOffset}`,
      search,
    })
    const { secret } = await new SKRegistryStore(state).write(
      {
        owner: 'agent:no-search-access',
        scopes: [{ pattern: 'public/**', actions: ['read', 'call'] }],
      },
      new Date().toISOString(),
    )

    const response = await postSearch(app, { query: 'private', opts: { limit: 200 } }, secret)
    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ items: [] })
    expect(search).toHaveBeenCalledTimes(4)
  })
})
