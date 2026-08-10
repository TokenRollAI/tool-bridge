import {
  MemoryStateStore,
  NodeRegistryStore,
  type SearchIndex,
  SecretStoreImpl,
  SKRegistryStore,
} from '@tool-bridge/core'
import { describe, expect, it, vi } from 'vitest'
import { TEST_ADMIN_SK, TEST_ENCRYPTION_KEY } from './fixtures'
import { runBootstrap } from '../src/bootstrap'
import { createTbApp } from '../src/tbApp'

const adminHeaders = {
  'accept': 'application/json',
  'authorization': `Bearer ${TEST_ADMIN_SK}`,
  'content-type': 'application/json',
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

describe('global ~search protocol', () => {
  it('keeps root describe and search absent without a declared implementation', async () => {
    const { app } = await appWith()

    const describeResponse = await app.request('https://tb.test/~describe', {
      headers: adminHeaders,
    })
    expect(describeResponse.status).toBe(404)
    expect((await postSearch(app, { query: 'weather' })).status).toBe(404)
  })

  it('authenticates before dispatching to the injected index', async () => {
    const search = vi.fn(async () => ({ items: [] }))
    const { app } = await appWith({ capabilities: ['search'], search })

    const response = await postSearch(app, { query: 'weather' }, null)

    expect(response.status).toBe(401)
    expect(search).not.toHaveBeenCalled()
  })

  it('describes keyword search and returns the root-only page contract', async () => {
    const search = vi.fn(async () => ({
      items: [
        {
          path: 'providers/weather',
          tool: {
            name: 'forecast',
            description: 'Get a weather forecast',
            inputSchema: { type: 'object' },
          },
        },
        {
          path: 'providers/weather',
          tool: { name: 'internal_forecast', description: 'Hidden upstream tool' },
        },
      ],
      cursor: 'not-exposed-before-pagination-contract',
    }))
    const { app, state } = await appWith({ capabilities: ['search'], search })
    await new NodeRegistryStore(state).write(
      {
        path: 'providers/weather',
        kind: 'http',
        description: 'Weather tools',
        config: {
          kind: 'http',
          endpoint: 'https://weather.example.test',
          tools: [],
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
            inputSchema: { type: 'object' },
          },
        },
      ],
    })
    expect(search).toHaveBeenCalledOnce()
    expect(search).toHaveBeenCalledWith('weather', { mode: 'keyword' })

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
    const search = vi.fn(async () => ({ items: [] }))
    const { app } = await appWith({ capabilities: ['search'], search })

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

    const prematurePagination = await postSearch(app, {
      query: 'weather',
      opts: { limit: 10 },
    })
    expect(prematurePagination.status).toBe(400)

    expect((await postSearch(app, { query: '   ' })).status).toBe(400)
    expect((await postSearch(app, [])).status).toBe(400)
    expect(search).not.toHaveBeenCalled()
  })

  it('accepts semantic mode only when the implementation declares it', async () => {
    const search = vi.fn(async () => ({ items: [] }))
    const { app } = await appWith({ capabilities: ['search', 'search:semantic'], search })

    const response = await postSearch(app, {
      query: 'weather',
      opts: { mode: 'semantic' },
    })

    expect(response.status).toBe(200)
    expect(search).toHaveBeenCalledWith('weather', { mode: 'semantic' })
  })
})
