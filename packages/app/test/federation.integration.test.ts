import type { CallContext, HelpJson, TreeJson } from '@tool-bridge/core'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { federatedSearchSessionStateKey } from '../src/search/federatedSession'
import { bearer, createTestApp, TEST_REMOTE, type TestApp } from './harness'
import { RemotePathProjector } from '../src/federation'
import { MemorySearchIndex } from './memorySearchIndex'
import { TEST_ADMIN_SK } from './fixtures'

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

async function mountRemote(
  app: TestApp,
  path: string,
  baseUrl: string,
  skRef: string,
): Promise<void> {
  const response = await postJson(app, 'system/registry/write', {
    path,
    kind: 'remote',
    description: `${path} federation mount`,
    config: { kind: 'remote', baseUrl, skRef },
  })
  expect(response.status).toBe(200)
}

async function mountHttp(app: TestApp, path: string, name: string): Promise<void> {
  const response = await postJson(app, 'system/registry/write', {
    path,
    kind: 'http',
    description: `${path} tools`,
    config: {
      kind: 'http',
      endpoint: 'https://upstream.example',
      tools: [{
        name,
        description: `${name} description`,
        inputSchema: {
          additionalProperties: false,
          properties: {},
          type: 'object',
        },
        method: 'GET',
        pathTemplate: `/${name}`,
      }],
    },
  })
  expect(response.status).toBe(200)
}

function allPaths(tree: TreeJson): string[] {
  return [tree.path, ...(tree.children ?? []).flatMap(allPaths)]
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('nested remote path projection', () => {
  it('rebases A→B→C help/tree paths and reapplies A descendant scopes', async () => {
    const a = await createTestApp({
      remote: { ...TEST_REMOTE, allowlist: ['b.test'], instanceId: 'instance-a' },
      search: new MemorySearchIndex(),
    })
    const b = await createTestApp({
      remote: { ...TEST_REMOTE, allowlist: ['c.test'], instanceId: 'instance-b' },
      search: new MemorySearchIndex(),
    })
    const c = await createTestApp({
      remote: { ...TEST_REMOTE, allowlist: [], instanceId: 'instance-c' },
      search: new MemorySearchIndex(),
    })
    const now = new Date().toISOString()
    await a.secrets.set('to-b', TEST_ADMIN_SK, now)
    await b.secrets.set('to-c', TEST_ADMIN_SK, now)
    await mountRemote(a, 'outer', 'https://b.test', 'to-b')
    await mountRemote(b, 'inner', 'https://c.test', 'to-c')
    await mountHttp(c, 'sensors/climate', 'read_state')
    await mountHttp(c, 'private/hidden', 'read_secret')

    const routes = new Map([
      ['b.test', b],
      ['c.test', c],
    ])
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input))
      const target = routes.get(url.host)
      if (target === undefined) throw new Error(`unexpected federation target '${url.host}'`)
      return await target.request(url, init)
    }))

    const helpResponse = await a.request(
      'https://a.test/outer/inner/sensors/climate/~help',
      bearer(TEST_ADMIN_SK, { headers: { accept: 'application/json' } }),
    )
    expect(helpResponse.status).toBe(200)
    const help = await helpResponse.json() as HelpJson
    expect(help.node.path).toBe('outer/inner/sensors/climate')
    expect(help.cmds).toHaveLength(1)
    expect(help.cmds[0]?.path).toBe('/outer/inner/sensors/climate/read_state')

    const detailResponse = await a.request(
      `https://a.test${help.cmds[0]?.path}/~help`,
      bearer(TEST_ADMIN_SK, { headers: { accept: 'application/json' } }),
    )
    expect(detailResponse.status).toBe(200)
    const detail = await detailResponse.json() as HelpJson
    expect(detail.node.path).toBe('outer/inner/sensors/climate/read_state')
    expect(detail.cmds[0]?.path).toBe('/outer/inner/sensors/climate/read_state')
    expect(detail.cmds[0]?.inputSchema).toEqual(expect.objectContaining({ type: 'object' }))

    const issued = await postJson(a, 'system/sk/write', {
      owner: 'agent:narrow-federation',
      scopes: [
        { pattern: 'outer/**', actions: ['read', 'call'] },
        {
          pattern: 'outer/inner/private/**',
          actions: ['read', 'call'],
          effect: 'deny',
        },
      ],
    })
    expect(issued.status).toBe(200)
    const narrowSk = (await issued.json() as { secret: string }).secret

    const treeResponse = await a.request(
      'https://a.test/~tree?depth=8',
      bearer(narrowSk, { headers: { accept: 'application/json' } }),
    )
    expect(treeResponse.status).toBe(200)
    const paths = allPaths(await treeResponse.json() as TreeJson)
    expect(paths).toContain('outer/inner/sensors/climate')
    expect(paths.some(path => path.startsWith('outer/inner/private'))).toBe(false)

    const directTreeResponse = await a.request(
      'https://a.test/outer/inner/~tree?depth=4',
      bearer(narrowSk, { headers: { accept: 'application/json' } }),
    )
    expect(directTreeResponse.status).toBe(200)
    const directTree = await directTreeResponse.json() as TreeJson
    expect(directTree.path).toBe('outer/inner')
    expect(allPaths(directTree)).toContain('outer/inner/sensors/climate')
    expect(allPaths(directTree).some(path => path.startsWith('outer/inner/private'))).toBe(false)

    const searchResponse = await postJson(a, '~search', {
      query: 'read state',
      opts: { detail: 'full', federation: 'recursive', limit: 3 },
    })
    expect(searchResponse.status).toBe(200)
    const search = await searchResponse.json() as {
      items: Array<{
        path: string
        source?: { path: string }
        tool: { inputSchema?: unknown, name: string }
      }>
      partial?: boolean
    }
    expect(search.partial).not.toBe(true)
    expect(search.items).toEqual([
      expect.objectContaining({
        path: 'outer/inner/sensors/climate',
        source: { path: 'outer/inner' },
        tool: expect.objectContaining({
          inputSchema: expect.objectContaining({ type: 'object' }),
          name: 'read_state',
        }),
      }),
    ])

    const narrowSearchResponse = await a.request('https://a.test/~search', {
      method: 'POST',
      headers: {
        ...bearer(narrowSk).headers,
        'accept': 'application/json',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        query: 'read',
        opts: { federation: 'recursive', matching: 'best' },
      }),
    })
    expect(narrowSearchResponse.status).toBe(200)
    const narrowSearch = await narrowSearchResponse.json() as {
      items: Array<{ path: string }>
    }
    expect(narrowSearch.items.map(item => item.path)).toContain('outer/inner/sensors/climate')
    expect(narrowSearch.items.some(item => item.path.includes('/private/'))).toBe(false)
  })

  it('paginates a balanced A→B→C result set with fixed-size server-side handles', async () => {
    const a = await createTestApp({
      remote: { ...TEST_REMOTE, allowlist: ['b.test'], instanceId: 'page-a' },
      search: new MemorySearchIndex(),
    })
    const b = await createTestApp({
      remote: { ...TEST_REMOTE, allowlist: ['c.test'], instanceId: 'page-b' },
      search: new MemorySearchIndex(),
    })
    const c = await createTestApp({
      remote: { ...TEST_REMOTE, allowlist: [], instanceId: 'page-c' },
      search: new MemorySearchIndex(),
    })
    const now = new Date().toISOString()
    await a.secrets.set('to-page-b', TEST_ADMIN_SK, now)
    await b.secrets.set('to-page-c', TEST_ADMIN_SK, now)
    await mountHttp(a, 'local/state', 'read_state_local')
    await mountHttp(a, 'local/state-two', 'read_state_local_two')
    await mountRemote(a, 'outer', 'https://b.test', 'to-page-b')
    await mountRemote(b, 'inner', 'https://c.test', 'to-page-c')
    await mountHttp(c, 'remote/state', 'read_state_remote')
    await mountHttp(c, 'remote/state-two', 'read_state_remote_two')

    const routes = new Map([
      ['b.test', b],
      ['c.test', c],
    ])
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input))
      const target = routes.get(url.host)
      if (target === undefined) throw new Error(`unexpected federation target '${url.host}'`)
      return await target.request(url, init)
    }))

    const firstResponse = await postJson(a, '~search', {
      query: 'read state',
      opts: { federation: 'recursive', limit: 1 },
    })
    expect(firstResponse.status).toBe(200)
    const first = await firstResponse.json() as {
      cursor?: string
      items: Array<{ source?: { path: string }, tool: { name: string } }>
    }
    expect(first.items[0]).toMatchObject({ source: { path: '' }, tool: { name: 'read_state_local' } })
    expect(first.cursor).toMatch(/^fsc1_[A-Za-z0-9_-]{32}$/u)
    expect(first.cursor).toHaveLength(37)

    const secondResponse = await postJson(a, '~search', {
      query: 'read state',
      opts: { cursor: first.cursor, federation: 'recursive', limit: 1 },
    })
    expect(secondResponse.status).toBe(200)
    const second = await secondResponse.json() as {
      cursor?: string
      items: Array<{ path: string, source?: { path: string }, tool: { name: string } }>
    }
    expect(second.items[0]).toMatchObject({
      path: 'outer/inner/remote/state',
      source: { path: 'outer/inner' },
      tool: { name: 'read_state_remote' },
    })
    expect(second.cursor).toMatch(/^fsc1_[A-Za-z0-9_-]{32}$/u)

    // PostgreSQL jsonb does not preserve object insertion order. Reorder a nested
    // cached object to ensure semantic continuation checks do not use raw stringify.
    const firstRecord = await a.state.get(await federatedSearchSessionStateKey(first.cursor!)) as {
      nextHandle: string
    }
    const secondKey = await federatedSearchSessionStateKey(firstRecord.nextHandle)
    const secondRecord = await a.state.get(secondKey) as Record<string, unknown>
    await a.state.put(secondKey, {
      ...secondRecord,
      federationPolicy: { matching: 'best', limit: 1 },
    })

    const retryResponse = await postJson(a, '~search', {
      query: 'read state',
      opts: { cursor: first.cursor, federation: 'recursive', limit: 1 },
    })
    expect(retryResponse.status).toBe(200)
    expect(await retryResponse.json()).toEqual(second)

    const thirdResponse = await postJson(a, '~search', {
      query: 'read state',
      opts: { cursor: second.cursor, federation: 'recursive', limit: 1 },
    })
    expect(thirdResponse.status).toBe(200)
    const third = await thirdResponse.json() as {
      cursor?: string
      items: Array<{ source?: { path: string }, tool: { name: string } }>
    }
    expect(third.items[0]).toMatchObject({
      source: { path: '' },
      tool: { name: 'read_state_local_two' },
    })
    expect(third.cursor).toMatch(/^fsc1_[A-Za-z0-9_-]{32}$/u)

    const fourthResponse = await postJson(a, '~search', {
      query: 'read state',
      opts: { cursor: third.cursor, federation: 'recursive', limit: 1 },
    })
    expect(fourthResponse.status).toBe(200)
    const fourth = await fourthResponse.json() as {
      cursor?: string
      items: Array<{ source?: { path: string }, tool: { name: string } }>
    }
    expect(fourth.items[0]).toMatchObject({
      source: { path: 'outer/inner' },
      tool: { name: 'read_state_remote_two' },
    })
    expect(fourth.cursor).toBeUndefined()

    // A 的第二页已经缓存；即使重试最早的 A cursor，也必须递归验证 B 保存的
    // C snapshot。C 的搜索 revision 变化后，不能返回旧的缓存页。
    await mountHttp(c, 'remote/state-three', 'read_state_remote_three')
    const staleCachedResponse = await postJson(a, '~search', {
      query: 'read state',
      opts: { cursor: first.cursor, federation: 'recursive', limit: 1 },
    })
    expect(staleCachedResponse.status).toBe(400)
    await expect(staleCachedResponse.json()).resolves.toMatchObject({
      code: 'invalid_argument',
      retryable: false,
    })
  })

  it('propagates the full-hydration deadline through A→B→C and aborts a stalled body', async () => {
    const federatedSearch = {
      minChildWorkMs: 1,
      perHopReturnReserveMs: 5,
      totalDeadlineMs: 100,
    }
    const a = await createTestApp({
      remote: {
        ...TEST_REMOTE,
        allowlist: ['deadline-b.test'],
        federatedSearch,
        instanceId: 'deadline-full-a',
      },
      search: new MemorySearchIndex(),
    })
    const b = await createTestApp({
      remote: {
        ...TEST_REMOTE,
        allowlist: ['deadline-c.test'],
        federatedSearch,
        instanceId: 'deadline-full-b',
      },
      search: new MemorySearchIndex(),
    })
    const c = await createTestApp({
      remote: {
        ...TEST_REMOTE,
        allowlist: [],
        federatedSearch,
        instanceId: 'deadline-full-c',
      },
      search: new MemorySearchIndex(),
    })
    const now = new Date().toISOString()
    await a.secrets.set('to-deadline-b', TEST_ADMIN_SK, now)
    await b.secrets.set('to-deadline-c', TEST_ADMIN_SK, now)
    await mountRemote(a, 'outer', 'https://deadline-b.test', 'to-deadline-b')
    await mountRemote(b, 'inner', 'https://deadline-c.test', 'to-deadline-c')
    await mountHttp(c, 'sensors/deadline', 'read_deadline')

    const cancel = vi.fn()
    const routes = new Map([
      ['deadline-b.test', b],
      ['deadline-c.test', c],
    ])
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input))
      if (url.host === 'deadline-c.test' && url.pathname.endsWith('/~help')) {
        return new Response(new ReadableStream<Uint8Array>({
          cancel,
          pull() {
            return new Promise(() => {})
          },
        }), { headers: { 'content-type': 'application/json' } })
      }
      const target = routes.get(url.host)
      if (target === undefined) throw new Error(`unexpected federation target '${url.host}'`)
      return await target.request(url, init)
    }))

    const startedAt = Date.now()
    const response = await postJson(a, '~search', {
      query: 'read deadline',
      opts: { detail: 'full', federation: 'recursive', limit: 1 },
    })
    expect(Date.now() - startedAt).toBeLessThan(1_000)
    expect(response.status).toBe(503)
    await expect(response.json()).resolves.toMatchObject({
      code: 'unavailable',
      retryable: true,
    })
    await vi.waitFor(() => expect(cancel).toHaveBeenCalled())
  })

  it.each([
    { kind: 'node', value: '../inner' },
    { kind: 'node', value: '/inner' },
    { kind: 'node', value: '%2525252e' },
    { kind: 'node', value: '%70rivate' },
    { kind: 'node', value: 'Sensors/Climate' },
    { kind: 'node', value: 'inner?admin=1' },
    { kind: 'command', value: '/inner/run#fragment' },
    { kind: 'command', value: '/outside/run' },
    { kind: 'command', value: '//inner/run' },
  ] as const)('rejects unsafe remote help $kind path $value', ({ kind, value }) => {
    const projector = new RemotePathProjector('outer')
    const help: HelpJson = {
      htbp: '0.1',
      node: { path: kind === 'node' ? value : 'inner', kind: 'http', description: 'remote' },
      cmds: [{
        name: 'run',
        method: 'POST',
        path: kind === 'command' ? value : '/inner/run',
        scope: 'call',
      }],
    }
    expect(() => projector.projectHelp(help, 'outer/inner')).toThrowError(
      expect.objectContaining({ code: 'unavailable', retryable: false }),
    )
  })

  it.each(['../leaf', '/inner/leaf', '%2525252e', 'outside/leaf'])(
    'rejects unsafe remote tree child path %s',
    (path) => {
      const projector = new RemotePathProjector('outer')
      const ctx: CallContext = {
        keyId: 'test',
        owner: 'agent:test',
        scopes: [{ pattern: '**', actions: ['read', 'call'] }],
        traceId: 'trace',
      }
      const tree: TreeJson = {
        path: 'inner',
        kind: 'directory',
        description: 'inner',
        children: [{ path, kind: 'http', description: 'child' }],
      }
      expect(() => projector.projectTree(tree, 'outer/inner', ctx)).toThrowError(
        expect.objectContaining({ code: 'unavailable', retryable: false }),
      )
    },
  )
})
