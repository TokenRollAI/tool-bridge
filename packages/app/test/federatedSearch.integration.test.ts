import { type WireToolSearchPage } from '@tool-bridge/core/protocol'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { FEDERATED_SEARCH_SESSION_KEY_PREFIX } from '../src/search/federatedSession'
import { bearer, createTestApp, TEST_REMOTE, type TestApp } from './harness'
import { MemorySearchIndex } from './memorySearchIndex'
import { TEST_ADMIN_SK } from './fixtures'

interface SearchPage extends WireToolSearchPage {
  cursor?: string
}

async function postJson(app: TestApp, path: string, body: unknown): Promise<Response> {
  return await app.request(`https://local.test/${path}`, {
    ...bearer(),
    method: 'POST',
    headers: {
      ...bearer().headers,
      'accept': 'application/json',
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
  })
}

async function postSearch(app: TestApp, body: unknown): Promise<Response> {
  return await postJson(app, '~search', body)
}

async function postSearchAs(app: TestApp, body: unknown, sk: string): Promise<Response> {
  return await app.request('https://local.test/~search', {
    method: 'POST',
    headers: {
      ...bearer(sk).headers,
      'accept': 'application/json',
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
  })
}

async function mountRemote(
  app: TestApp,
  path: string,
  baseUrl: string,
  skRef?: string,
): Promise<void> {
  const response = await postJson(app, 'system/registry/write', {
    path,
    kind: 'remote',
    description: `${path} federated source`,
    config: {
      kind: 'remote',
      baseUrl,
      ...(skRef === undefined ? {} : { skRef }),
    },
  })
  expect(response.status).toBe(200)
}

async function mountHttp(
  app: TestApp,
  path: string,
  name: string,
  description = `${name} searchable tool`,
): Promise<void> {
  const response = await postJson(app, 'system/registry/write', {
    path,
    kind: 'http',
    description: `${path} search fixture`,
    config: {
      kind: 'http',
      endpoint: 'https://upstream.example.test',
      tools: [{
        name,
        description,
        method: 'GET',
        pathTemplate: `/${name}`,
      }],
    },
  })
  expect(response.status).toBe(200)
}

function routeFetch(
  routes: ReadonlyMap<string, TestApp>,
  intercept?: (url: URL, init: RequestInit | undefined) => Response | undefined,
): ReturnType<typeof vi.fn> {
  const mock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input))
    const intercepted = intercept?.(url, init)
    if (intercepted !== undefined) return intercepted
    const target = routes.get(url.host)
    if (target === undefined) throw new Error(`unexpected federation target '${url.host}'`)
    return await target.request(url, init)
  })
  vi.stubGlobal('fetch', mock)
  return mock
}

function expectNoSensitiveLeak(value: unknown, ...rawMarkers: string[]): void {
  const serialized = JSON.stringify(value)
  expect(serialized).not.toMatch(/authorization|baseUrl|skRef|Bearer\s|https?:\/\//iu)
  expect(serialized).not.toContain(TEST_ADMIN_SK)
  for (const marker of rawMarkers) expect(serialized).not.toContain(marker)
}

async function paginatedPair(tag: string): Promise<{
  a: TestApp
  b: TestApp
  fetchMock: ReturnType<typeof vi.fn>
  host: string
}> {
  const host = `b-${tag}.test`
  const a = await createTestApp({
    remote: { ...TEST_REMOTE, allowlist: [host], instanceId: `a-${tag}` },
    search: new MemorySearchIndex(),
  })
  const b = await createTestApp({
    remote: { ...TEST_REMOTE, allowlist: [], instanceId: `b-${tag}` },
    search: new MemorySearchIndex(),
  })
  const now = new Date().toISOString()
  await a.secrets.set(`to-b-${tag}`, TEST_ADMIN_SK, now)
  await mountHttp(a, 'local/state', `${tag}_local`)
  await mountRemote(a, 'outer', `https://${host}`, `to-b-${tag}`)
  await mountHttp(b, 'remote/state', `${tag}_remote`)
  return {
    a,
    b,
    fetchMock: routeFetch(new Map([[host, b]])),
    host,
  }
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('federated global search acceptance', () => {
  it('does not advertise federation without explicit instanceId and rejects recursive search', async () => {
    const app = await createTestApp({
      remote: { ...TEST_REMOTE, instanceId: undefined },
      search: new MemorySearchIndex(),
    })
    const fetchMock = routeFetch(new Map())

    const describe = await app.request('https://local.test/~describe', bearer())
    expect(describe.status).toBe(200)
    await expect(describe.json()).resolves.toEqual({
      kind: 'directory',
      capabilities: ['search'],
    })

    const recursive = await postSearch(app, {
      query: 'weather',
      opts: { federation: 'recursive' },
    })
    expect(recursive.status).toBe(400)
    const body = await recursive.json()
    expect(body).toMatchObject({ code: 'invalid_argument' })
    expectNoSensitiveLeak(body)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('marks a remote without skRef unsupported without outbound I/O while local search succeeds', async () => {
    const app = await createTestApp({
      remote: { ...TEST_REMOTE, allowlist: ['unsupported.test'], instanceId: 'unsupported-a' },
      search: new MemorySearchIndex(),
    })
    await mountHttp(app, 'local/weather', 'weather_local')
    await mountRemote(app, 'remote-unsupported', 'https://unsupported.test')
    const fetchMock = routeFetch(new Map())

    const response = await postSearch(app, {
      query: 'weather',
      opts: { federation: 'recursive' },
    })
    expect(response.status).toBe(200)
    const page = await response.json() as SearchPage
    expect(page.items).toEqual([
      expect.objectContaining({
        path: 'local/weather',
        tool: expect.objectContaining({ name: 'weather_local' }),
      }),
    ])
    expect(page).toMatchObject({
      partial: true,
      sources: [{ path: 'remote-unsupported', status: 'unsupported' }],
    })
    expectNoSensitiveLeak(page, 'unsupported.test')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('aborts a slow child at the shared deadline and returns a controlled partial page', async () => {
    const app = await createTestApp({
      remote: {
        ...TEST_REMOTE,
        allowlist: ['slow.test'],
        federatedSearch: {
          minChildWorkMs: 5,
          perHopReturnReserveMs: 5,
          totalDeadlineMs: 40,
        },
        instanceId: 'deadline-a',
      },
      search: new MemorySearchIndex(),
    })
    await app.secrets.set('to-slow', TEST_ADMIN_SK, new Date().toISOString())
    await mountHttp(app, 'local/deadline', 'deadline_local')
    await mountRemote(app, 'slow', 'https://slow.test', 'to-slow')
    vi.stubGlobal('fetch', vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) =>
      await new Promise<Response>((_resolve, reject) => {
        const rejectAbort = () => reject(new DOMException('aborted', 'AbortError'))
        init?.signal?.addEventListener('abort', rejectAbort, { once: true })
        if (init?.signal?.aborted === true) rejectAbort()
      })))

    const startedAt = Date.now()
    const response = await postSearch(app, {
      query: 'deadline',
      opts: { federation: 'recursive' },
    })
    expect(Date.now() - startedAt).toBeLessThan(500)
    expect(response.status).toBe(200)
    const page = await response.json() as SearchPage
    expect(page.items[0]).toMatchObject({ tool: { name: 'deadline_local' } })
    expect(page).toMatchObject({
      partial: true,
      sources: [{ path: 'slow', status: 'timed_out' }],
    })
    expectNoSensitiveLeak(page, 'slow.test', 'to-slow')
  })

  it('locks pathPrefix to one direct remote and rewrites it into child coordinates', async () => {
    const a = await createTestApp({
      remote: { ...TEST_REMOTE, allowlist: ['b-prefix.test'], instanceId: 'prefix-a' },
      search: new MemorySearchIndex(),
    })
    const b = await createTestApp({
      remote: { ...TEST_REMOTE, allowlist: [], instanceId: 'prefix-b' },
      search: new MemorySearchIndex(),
    })
    await a.secrets.set('to-prefix-b', TEST_ADMIN_SK, new Date().toISOString())
    await mountHttp(a, 'local/climate', 'climate_local')
    await mountRemote(a, 'outer', 'https://b-prefix.test', 'to-prefix-b')
    await mountHttp(b, 'sensors/climate', 'climate_remote')
    const fetchMock = routeFetch(new Map([['b-prefix.test', b]]))

    const response = await postSearch(a, {
      query: 'climate',
      opts: {
        federation: 'recursive',
        pathPrefix: 'outer/sensors/climate',
      },
    })
    expect(response.status).toBe(200)
    const page = await response.json() as SearchPage
    expect(page.items).toEqual([
      expect.objectContaining({
        path: 'outer/sensors/climate',
        source: { path: 'outer' },
        tool: expect.objectContaining({ name: 'climate_remote' }),
      }),
    ])

    const childSearch = fetchMock.mock.calls.find(call =>
      new URL(String(call[0])).pathname === '/~search')
    expect(childSearch).toBeDefined()
    const childBody = JSON.parse(String((childSearch?.[1] as RequestInit | undefined)?.body)) as {
      opts?: { pathPrefix?: string }
    }
    expect(childBody.opts?.pathPrefix).toBe('sensors/climate')
    expectNoSensitiveLeak(page, 'b-prefix.test', 'to-prefix-b')
  })

  it.each([
    {
      label: 'pathPrefix',
      override: { path: 'admin/delete' },
    },
    {
      label: 'effect',
      override: { effect: 'destructive' },
    },
    {
      label: 'coverage',
      override: { coverage: 0.5, matchedTermCount: 1 },
    },
    {
      label: 'tool name',
      override: { name: '../run' },
    },
  ])('rejects a child result that violates the parent $label constraint', async ({ override }) => {
    const app = await createTestApp({
      remote: { ...TEST_REMOTE, allowlist: ['malicious.test'], instanceId: 'malicious-a' },
      search: new MemorySearchIndex(),
    })
    await app.secrets.set('to-malicious', TEST_ADMIN_SK, new Date().toISOString())
    await mountRemote(app, 'outer', 'https://malicious.test', 'to-malicious')
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input))
      if (url.pathname === '/~describe') {
        return Response.json({ capabilities: ['search', 'search:federated'] })
      }
      if (url.pathname === '/~search') {
        return Response.json({
          items: [{
            path: override.path ?? 'sensors/climate',
            relevance: {
              coverage: override.coverage ?? 1,
              matchedTermCount: override.matchedTermCount ?? 2,
              rankingVersion: 'keyword-v2',
              totalTermCount: 2,
            },
            tool: {
              effect: override.effect ?? 'read',
              name: override.name ?? 'read_temperature',
            },
          }],
        })
      }
      throw new Error(`unexpected malicious target '${url.pathname}'`)
    }))

    const response = await postSearch(app, {
      query: 'read temperature',
      opts: {
        effects: ['read'],
        federation: 'recursive',
        matching: 'all',
        pathPrefix: '/OUTER/SENSORS/',
      },
    })
    expect(response.status).toBe(503)
    await expect(response.json()).resolves.toMatchObject({
      code: 'unavailable',
      retryable: true,
    })
  })

  it('reports remotes beyond the direct source budget as budget_exhausted', async () => {
    const a = await createTestApp({
      remote: {
        ...TEST_REMOTE,
        allowlist: ['budget-one.test', 'budget-two.test'],
        federatedSearch: { maxSources: 2 },
        instanceId: 'budget-a',
      },
      search: new MemorySearchIndex(),
    })
    const one = await createTestApp({
      remote: { ...TEST_REMOTE, allowlist: [], instanceId: 'budget-one' },
      search: new MemorySearchIndex(),
    })
    const two = await createTestApp({
      remote: { ...TEST_REMOTE, allowlist: [], instanceId: 'budget-two' },
      search: new MemorySearchIndex(),
    })
    const now = new Date().toISOString()
    await a.secrets.set('to-budget-one', TEST_ADMIN_SK, now)
    await a.secrets.set('to-budget-two', TEST_ADMIN_SK, now)
    await mountHttp(a, 'local/budget', 'budget_local')
    await mountRemote(a, 'a-remote', 'https://budget-one.test', 'to-budget-one')
    await mountRemote(a, 'b-remote', 'https://budget-two.test', 'to-budget-two')
    const fetchMock = routeFetch(new Map([
      ['budget-one.test', one],
      ['budget-two.test', two],
    ]))

    const response = await postSearch(a, {
      query: 'budget',
      opts: { federation: 'recursive' },
    })
    expect(response.status).toBe(200)
    const page = await response.json() as SearchPage
    expect(page.items).toEqual([
      expect.objectContaining({
        path: 'local/budget',
        tool: expect.objectContaining({ name: 'budget_local' }),
      }),
    ])
    expect(page).toMatchObject({
      partial: true,
      sources: [{ path: 'b-remote', status: 'budget_exhausted' }],
    })
    expect(fetchMock.mock.calls.some(call => String(call[0]).includes('budget-two.test'))).toBe(false)
    expectNoSensitiveLeak(page, 'budget-one.test', 'budget-two.test', 'to-budget-one')
  })

  it('does not let a configured remote with a missing skRef secret consume a source slot', async () => {
    const a = await createTestApp({
      remote: {
        ...TEST_REMOTE,
        allowlist: ['missing-secret.test', 'ready.test'],
        federatedSearch: { maxSources: 2 },
        instanceId: 'secret-budget-a',
      },
      search: new MemorySearchIndex(),
    })
    const ready = await createTestApp({
      remote: { ...TEST_REMOTE, allowlist: [], instanceId: 'secret-budget-ready' },
      search: new MemorySearchIndex(),
    })
    await a.secrets.set('to-ready', TEST_ADMIN_SK, new Date().toISOString())
    await mountHttp(a, 'local/secret-budget', 'secret_budget_local')
    await mountRemote(a, 'a-missing', 'https://missing-secret.test', 'missing-secret-ref')
    await mountRemote(a, 'b-ready', 'https://ready.test', 'to-ready')
    await mountHttp(ready, 'remote/secret-budget', 'secret_budget_remote')
    const fetchMock = routeFetch(new Map([['ready.test', ready]]))

    const response = await postSearch(a, {
      query: 'secret budget',
      opts: { federation: 'recursive', limit: 4 },
    })
    expect(response.status).toBe(200)
    const page = await response.json() as SearchPage
    expect(page.items).toEqual(expect.arrayContaining([
      expect.objectContaining({
        path: 'local/secret-budget',
        tool: expect.objectContaining({ name: 'secret_budget_local' }),
      }),
      expect.objectContaining({
        path: 'b-ready/remote/secret-budget',
        tool: expect.objectContaining({ name: 'secret_budget_remote' }),
      }),
    ]))
    expect(page).toMatchObject({
      partial: true,
      sources: [{ path: 'a-missing', status: 'unavailable' }],
    })
    expect(fetchMock.mock.calls.some(call => String(call[0]).includes('missing-secret.test')))
      .toBe(false)
    expectNoSensitiveLeak(page, 'missing-secret.test', 'missing-secret-ref', 'ready.test', 'to-ready')
  })

  it('paginates and retries renamed local tools through canonical full hydration', async () => {
    const app = await createTestApp({
      remote: { ...TEST_REMOTE, allowlist: [], instanceId: 'virtualize-page-a' },
      search: new MemorySearchIndex(),
    })
    const response = await postJson(app, 'system/registry/write', {
      path: 'local/virtualized',
      kind: 'http',
      description: 'virtualized pagination fixture',
      config: {
        kind: 'http',
        endpoint: 'https://upstream.example.test',
        tools: [
          {
            name: 'raw_virtual_page_a',
            description: 'virtual page first',
            inputSchema: { type: 'object' },
            method: 'GET',
            pathTemplate: '/first',
          },
          {
            name: 'raw_virtual_page_b',
            description: 'virtual page second',
            inputSchema: { type: 'object' },
            method: 'GET',
            pathTemplate: '/second',
          },
        ],
      },
      virtualize: {
        rename: {
          raw_virtual_page_a: 'read_virtual_first',
          raw_virtual_page_b: 'read_virtual_second',
        },
      },
    })
    expect(response.status).toBe(200)

    const firstResponse = await postSearch(app, {
      query: 'virtual page',
      opts: { detail: 'full', federation: 'recursive', limit: 1 },
    })
    expect(firstResponse.status).toBe(200)
    const first = await firstResponse.json() as SearchPage
    expect(first.items[0]).toMatchObject({
      tool: {
        inputSchema: { type: 'object' },
        name: 'read_virtual_first',
      },
    })
    expect(first.cursor).toMatch(/^fsc1_[A-Za-z0-9_-]{32}$/u)

    const secondResponse = await postSearch(app, {
      query: 'virtual page',
      opts: { cursor: first.cursor, detail: 'full', federation: 'recursive', limit: 1 },
    })
    expect(secondResponse.status).toBe(200)
    const second = await secondResponse.json() as SearchPage
    expect(second.items[0]).toMatchObject({
      tool: {
        inputSchema: { type: 'object' },
        name: 'read_virtual_second',
      },
    })
    expect(second.cursor).toBeUndefined()

    const retryResponse = await postSearch(app, {
      query: 'virtual page',
      opts: { cursor: first.cursor, detail: 'full', federation: 'recursive', limit: 1 },
    })
    expect(retryResponse.status).toBe(200)
    await expect(retryResponse.json()).resolves.toEqual(second)
  })

  it('does not commit a root session when initial full hydration fails', async () => {
    const a = await createTestApp({
      remote: { ...TEST_REMOTE, allowlist: ['hydrate-fail.test'], instanceId: 'hydrate-fail-a' },
      search: new MemorySearchIndex(),
    })
    const b = await createTestApp({
      remote: { ...TEST_REMOTE, allowlist: [], instanceId: 'hydrate-fail-b' },
      search: new MemorySearchIndex(),
    })
    await a.secrets.set('to-hydrate-fail', TEST_ADMIN_SK, new Date().toISOString())
    await mountRemote(a, 'outer', 'https://hydrate-fail.test', 'to-hydrate-fail')
    await mountHttp(b, 'remote/hydrate-a', 'hydrate_failure_a')
    await mountHttp(b, 'remote/hydrate-b', 'hydrate_failure_b')
    routeFetch(new Map([['hydrate-fail.test', b]]), (url) => {
      if (!url.pathname.endsWith('/~help')) return undefined
      return Response.json({ code: 'unavailable', message: 'controlled help failure' }, {
        status: 503,
      })
    })

    const failedResponse = await postSearch(a, {
      query: 'hydrate failure',
      opts: { detail: 'full', federation: 'recursive', limit: 1 },
    })
    expect(failedResponse.status).toBe(503)
    await expect(failedResponse.json()).resolves.toMatchObject({
      code: 'unavailable',
      retryable: true,
    })
    expect((await a.state.list(FEDERATED_SEARCH_SESSION_KEY_PREFIX)).items).toHaveLength(0)
  })

  it('cuts A→B→A recursion into a cycle partial without looping', async () => {
    const a = await createTestApp({
      remote: { ...TEST_REMOTE, allowlist: ['cycle-b.test'], instanceId: 'cycle-a' },
      search: new MemorySearchIndex(),
    })
    const b = await createTestApp({
      remote: { ...TEST_REMOTE, allowlist: ['cycle-a.test'], instanceId: 'cycle-b' },
      search: new MemorySearchIndex(),
    })
    const now = new Date().toISOString()
    await a.secrets.set('cycle-to-b', TEST_ADMIN_SK, now)
    await b.secrets.set('cycle-to-a', TEST_ADMIN_SK, now)
    await mountHttp(a, 'local/cycle', 'cycle_local')
    await mountRemote(a, 'outer', 'https://cycle-b.test', 'cycle-to-b')
    await mountRemote(b, 'back', 'https://cycle-a.test', 'cycle-to-a')
    const fetchMock = routeFetch(new Map([
      ['cycle-a.test', a],
      ['cycle-b.test', b],
    ]))

    const response = await postSearch(a, {
      query: 'cycle',
      opts: { federation: 'recursive' },
    })
    expect(response.status).toBe(200)
    const page = await response.json() as SearchPage
    expect(page.items).toEqual([
      expect.objectContaining({
        path: 'local/cycle',
        tool: expect.objectContaining({ name: 'cycle_local' }),
      }),
    ])
    expect(page).toMatchObject({
      partial: true,
      sources: [{ path: 'outer/back', status: 'cycle' }],
    })
    expect(fetchMock.mock.calls.length).toBeLessThanOrEqual(4)
    expectNoSensitiveLeak(page, 'cycle-a.test', 'cycle-b.test', 'cycle-to-a', 'cycle-to-b')
  })

  it('returns retryable 503 for an active continuation failure and lets the same cursor recover', async () => {
    const { a, b, host } = await paginatedPair('retryable')
    let failValidation = false
    const rawMarker = 'RAW_REMOTE_RETRY_FAILURE'
    const fetchMock = routeFetch(new Map([[host, b]]), (url, init) => {
      const headers = new Headers(init?.headers)
      if (
        !failValidation
        || url.pathname !== '/~search'
        || headers.get('x-tb-search-validate-snapshot') !== '1'
      ) return undefined
      return new Response(JSON.stringify({
        code: 'internal',
        message: `${rawMarker} https://${host} to-b-retryable`,
      }), {
        status: 503,
        headers: { 'content-type': 'application/json' },
      })
    })

    const firstResponse = await postSearch(a, {
      query: 'retryable',
      opts: { federation: 'recursive', limit: 1 },
    })
    expect(firstResponse.status).toBe(200)
    const first = await firstResponse.json() as SearchPage
    expect(first.items[0]).toMatchObject({ tool: { name: 'retryable_local' } })
    expect(first.cursor).toMatch(/^fsc1_[A-Za-z0-9_-]{32}$/u)

    failValidation = true
    const failedResponse = await postSearch(a, {
      query: 'retryable',
      opts: { cursor: first.cursor, federation: 'recursive', limit: 1 },
    })
    expect(failedResponse.status).toBe(503)
    const failed = await failedResponse.json()
    expect(failed).toMatchObject({ code: 'unavailable', retryable: true })
    expectNoSensitiveLeak(failed, rawMarker, host, 'to-b-retryable')

    failValidation = false
    const recoveredResponse = await postSearch(a, {
      query: 'retryable',
      opts: { cursor: first.cursor, federation: 'recursive', limit: 1 },
    })
    expect(recoveredResponse.status).toBe(200)
    const recovered = await recoveredResponse.json() as SearchPage
    expect(recovered.items[0]).toMatchObject({
      path: 'outer/remote/state',
      tool: { name: 'retryable_remote' },
    })
    expect(recovered.cursor).toBeUndefined()
    expect(fetchMock).toHaveBeenCalled()
    expectNoSensitiveLeak(recovered, rawMarker, host, 'to-b-retryable')
  })

  it('fails a stored cursor closed after registry topology changes', async () => {
    const { a, b, host } = await paginatedPair('topology')
    const fetchMock = routeFetch(new Map([[host, b]]))
    const firstResponse = await postSearch(a, {
      query: 'topology',
      opts: { federation: 'recursive', limit: 1 },
    })
    expect(firstResponse.status).toBe(200)
    const first = await firstResponse.json() as SearchPage
    expect(first.cursor).toMatch(/^fsc1_[A-Za-z0-9_-]{32}$/u)

    await mountHttp(a, 'local/topology-new', 'topology_new')
    const staleResponse = await postSearch(a, {
      query: 'topology',
      opts: { cursor: first.cursor, federation: 'recursive', limit: 1 },
    })
    expect(staleResponse.status).toBe(400)
    const stale = await staleResponse.json()
    expect(stale).toMatchObject({
      code: 'invalid_argument',
      retryable: false,
    })
    expectNoSensitiveLeak(stale, host, 'to-b-topology')
    expect(fetchMock).toHaveBeenCalled()
  })

  it('continues past a pending compact item whose canonical description exceeds 1 KiB', async () => {
    const app = await createTestApp({
      remote: { ...TEST_REMOTE, allowlist: [], instanceId: 'long-description-a' },
      search: new MemorySearchIndex(),
    })
    const description = `long description ${'界'.repeat(800)}`
    await mountHttp(app, 'long/a', 'long_description_a', description)
    await mountHttp(app, 'long/b', 'long_description_b', description)

    const firstResponse = await postSearch(app, {
      query: 'long description',
      opts: { federation: 'recursive', limit: 1 },
    })
    expect(firstResponse.status).toBe(200)
    const first = await firstResponse.json() as SearchPage
    expect(first.cursor).toMatch(/^fsc1_[A-Za-z0-9_-]{32}$/u)
    expect(new TextEncoder().encode(first.items[0]?.tool.description ?? '').length)
      .toBeLessThanOrEqual(1_024)

    const secondResponse = await postSearch(app, {
      query: 'long description',
      opts: { cursor: first.cursor, federation: 'recursive', limit: 1 },
    })
    expect(secondResponse.status).toBe(200)
    const second = await secondResponse.json() as SearchPage
    expect(second.items).toHaveLength(1)
    expect(new TextEncoder().encode(second.items[0]?.tool.description ?? '').length)
      .toBeLessThanOrEqual(1_024)
  })

  it('re-filters cached source statuses after the same actor key loses descendant scope', async () => {
    const a = await createTestApp({
      remote: { ...TEST_REMOTE, allowlist: ['scope-b.test'], instanceId: 'scope-a' },
      search: new MemorySearchIndex(),
    })
    const b = await createTestApp({
      remote: {
        ...TEST_REMOTE,
        allowlist: ['unused-private.test'],
        instanceId: 'scope-b',
      },
      search: new MemorySearchIndex(),
    })
    const now = new Date().toISOString()
    await a.secrets.set('to-scope-b', TEST_ADMIN_SK, now)
    await mountRemote(a, 'outer', 'https://scope-b.test', 'to-scope-b')
    await mountHttp(b, 'public/a', 'scope_status_a')
    await mountHttp(b, 'public/b', 'scope_status_b')
    await mountRemote(b, 'private', 'https://unused-private.test')
    routeFetch(new Map([['scope-b.test', b]]))

    const issuedResponse = await postJson(a, 'system/sk/write', {
      owner: 'agent:mutable-scope',
      scopes: [{ pattern: 'outer/**', actions: ['read', 'call'] }],
    })
    expect(issuedResponse.status).toBe(200)
    const issued = await issuedResponse.json() as { key: { id: string }, secret: string }
    const request = {
      query: 'scope status',
      opts: { federation: 'recursive', limit: 1, pathPrefix: 'outer' },
    }
    const firstResponse = await postSearchAs(a, request, issued.secret)
    expect(firstResponse.status).toBe(200)
    const first = await firstResponse.json() as SearchPage
    expect(first.cursor).toMatch(/^fsc1_[A-Za-z0-9_-]{32}$/u)

    const secondResponse = await postSearchAs(a, {
      ...request,
      opts: { ...request.opts, cursor: first.cursor },
    }, issued.secret)
    expect(secondResponse.status).toBe(200)
    const second = await secondResponse.json() as SearchPage
    expect(second).toMatchObject({
      partial: true,
      sources: [{ path: 'outer/private', status: 'unsupported' }],
    })

    const update = await postJson(a, 'system/sk/update', {
      id: issued.key.id,
      patch: {
        scopes: [
          { pattern: 'outer/**', actions: ['read', 'call'] },
          {
            pattern: 'outer/private/**',
            actions: ['read', 'call'],
            effect: 'deny',
          },
        ],
      },
    })
    expect(update.status).toBe(200)

    const retryResponse = await postSearchAs(a, {
      ...request,
      opts: { ...request.opts, cursor: first.cursor },
    }, issued.secret)
    expect(retryResponse.status).toBe(400)
    await expect(retryResponse.json()).resolves.toMatchObject({
      code: 'invalid_argument',
      retryable: false,
    })

    const freshResponse = await postSearchAs(a, {
      ...request,
      opts: { ...request.opts, limit: 2 },
    }, issued.secret)
    expect(freshResponse.status).toBe(200)
    const fresh = await freshResponse.json() as SearchPage
    expect(fresh.items).toHaveLength(2)
    expect(fresh.partial).toBeUndefined()
    expect(fresh.sources).toBeUndefined()
  })
})
