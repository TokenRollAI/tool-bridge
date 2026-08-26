import { describe, expect, expectTypeOf, it, vi } from 'vitest'
import {
  createToolBridgeClient,
  fixedControlPlaneOpenApi,
  ToolBridgeClientError,
  type ToolSearchFederation,
  type ToolSearchPage,
  type ToolSearchRequest,
  type ToolSearchSourceResult,
  type ToolSearchSourceStatus,
} from '../../src/client/index'
import fixture from '../../../../test/fixtures/fixed-control-plane.json'

function json(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

describe('@tool-bridge/sdk/client', () => {
  it('assembles Bearer and repeated query with fail-closed fetch options', async () => {
    const fetcher = vi.fn(async () => json({ ok: true }))
    const client = createToolBridgeClient({
      baseUrl: 'https://gw.example/',
      sk: 'tbk_secret',
      fetcher: fetcher as typeof fetch,
    })
    await client.raw({
      path: 'x',
      query: { tag: ['a', 'b'], limit: 2, absent: undefined },
    })
    const [url, init] = fetcher.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('https://gw.example/x?tag=a&tag=b&limit=2')
    expect(new Headers(init.headers).get('authorization')).toBe('Bearer tbk_secret')
    expect(init.credentials).toBe('omit')
    expect(init.redirect).toBe('error')
  })

  it('resolves rotating credentials once for every reconnect-independent request', async () => {
    let count = 0
    const fetcher = vi.fn(async () => json(fixture.health))
    const client = createToolBridgeClient({
      baseUrl: 'https://gw.example',
      sk: () => `tbk_${++count}`,
      fetcher: fetcher as typeof fetch,
    })
    await client.getHelp().catch(() => {})
    await client.getHelp().catch(() => {})
    expect(count).toBe(2)
  })

  it('uses exact fixed paths, raw invoke body, and validates the shared fixture', async () => {
    const responses = [
      fixture.help,
      fixture.tree,
      fixture.search,
      fixture.oauth,
      { ...fixture.registryNode, driverKey: 'must-not-cross' },
    ]
    const fetcher = vi.fn(async () => json(responses.shift()))
    const client = createToolBridgeClient({
      baseUrl: 'https://gw.example',
      sk: 'tbk_fixture',
      fetcher: fetcher as typeof fetch,
    })
    expect(await client.getHelp('docs/hello world', { schemas: true })).toEqual(fixture.help)
    expect(await client.getTree('', { depth: 3 })).toEqual(fixture.tree)
    expect(await client.search({ query: ' status ', opts: { mode: 'keyword' } })).toEqual(fixture.search)
    expect(await client.startOAuthAuthorization('db/main')).toEqual(fixture.oauth)
    expect(await client.registerNode({
      path: 'docs/fixture',
      kind: 'context',
      description: 'Fixture context',
      config: { kind: 'context', provider: 'r2' },
    })).toEqual(fixture.registryNode)
    const calls = fetcher.mock.calls as unknown as Array<[string, RequestInit]>
    expect(calls.map(call => call[0])).toEqual([
      'https://gw.example/docs/hello%20world/~help?schemas=1',
      'https://gw.example/~tree?depth=3',
      'https://gw.example/~search',
      'https://gw.example/db/main/~authorize',
      'https://gw.example/docs/fixture/~register',
    ])
    expect(JSON.parse(String(calls[2]?.[1].body))).toEqual({
      query: 'status',
      opts: { mode: 'keyword' },
    })
    expect(JSON.parse(String(calls[4]?.[1].body))).toEqual({
      path: 'docs/fixture',
      kind: 'context',
      description: 'Fixture context',
      config: { kind: 'context', provider: 'r2' },
    })
  })

  it('sends every search option unchanged and parses compact relevance without schemas', async () => {
    const fetcher = vi.fn(async () => json(fixture.search))
    const client = createToolBridgeClient({
      baseUrl: 'https://gw.example',
      sk: 'tbk_search',
      fetcher: fetcher as typeof fetch,
    })

    const result = await client.search({
      query: ' temperature ',
      opts: {
        detail: 'compact',
        effects: ['read', 'unknown'],
        federation: 'recursive',
        limit: 10,
        matching: 'best',
        minCoverage: 0.75,
        mode: 'keyword',
        pathPrefix: 'home/home-assistant',
      },
    })

    const [url, init] = fetcher.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('https://gw.example/~search')
    expect(JSON.parse(String(init.body))).toEqual({
      query: 'temperature',
      opts: {
        detail: 'compact',
        effects: ['read', 'unknown'],
        federation: 'recursive',
        limit: 10,
        matching: 'best',
        minCoverage: 0.75,
        mode: 'keyword',
        pathPrefix: 'home/home-assistant',
      },
    })
    expect(result.items[0]?.relevance).toEqual({
      coverage: 1,
      matchedTermCount: 1,
      rankingVersion: 'keyword-v2',
      totalTermCount: 1,
    })
    expect(result.items[0]?.tool).not.toHaveProperty('inputSchema')
    expect(result.items[0]?.tool).not.toHaveProperty('outputSchema')
  })

  it('parses federated source evidence and exposes its public types', async () => {
    const page = {
      items: [{
        path: 'remotes/home/devices/climate',
        relevance: {
          coverage: 1,
          matchedTermCount: 2,
          rankingVersion: 'keyword-v2',
          totalTermCount: 2,
        },
        source: { path: 'remotes/home' },
        tool: { name: 'read_temperature' },
      }],
      partial: true,
      sources: [
        { path: '', status: 'ok' },
        { path: 'remotes/home', status: 'timed_out' },
      ],
    }
    const fetcher = vi.fn(async () => json(page))
    const client = createToolBridgeClient({ baseUrl: '', fetcher: fetcher as typeof fetch })

    expect(await client.search({
      query: 'read temperature',
      opts: { federation: 'recursive' },
    })).toEqual(page)
    expectTypeOf<NonNullable<ToolSearchRequest['opts']>['federation']>()
      .toEqualTypeOf<ToolSearchFederation | undefined>()
    expectTypeOf<NonNullable<ToolSearchPage['sources']>[number]>()
      .toEqualTypeOf<ToolSearchSourceResult>()
    expectTypeOf<ToolSearchSourceResult['status']>()
      .toEqualTypeOf<ToolSearchSourceStatus>()
  })

  it('parses full search schemas and fails closed when relevance is absent', async () => {
    const relevance = {
      coverage: 0.5,
      matchedTermCount: 1,
      rankingVersion: 'keyword-v2',
      totalTermCount: 2,
    } as const
    const full = {
      items: [{
        path: 'home/home-assistant',
        relevance,
        tool: {
          description: 'Read state',
          inputSchema: {
            additionalProperties: false,
            properties: { entityId: { type: 'string' } },
            required: ['entityId'],
            type: 'object',
          },
          name: 'get_state',
          outputSchema: {
            properties: { state: { type: 'string' } },
            type: 'object',
          },
        },
      }],
    }
    const withoutRelevance = {
      items: [{
        path: 'home/home-assistant',
        tool: { name: 'get_state' },
      }],
    }
    const fetcher = vi.fn()
      .mockResolvedValueOnce(json(full))
      .mockResolvedValueOnce(json(withoutRelevance))
    const client = createToolBridgeClient({ baseUrl: '', fetcher: fetcher as typeof fetch })

    expect(await client.search({ query: 'state', opts: { detail: 'full' } })).toEqual(full)
    await expect(client.search({ query: 'state' })).rejects.toMatchObject({
      code: 'internal',
      kind: 'protocol',
      retryable: true,
    })
  })

  it.each([
    { opts: { detail: 'compact' }, query: 'status', unexpected: true },
    { opts: { detail: 'compact', unexpected: true }, query: 'status' },
    { opts: { federation: 'direct' }, query: 'status' },
  ])('rejects unknown search request fields before sending', async (input) => {
    const fetcher = vi.fn(async () => json(fixture.search))
    const client = createToolBridgeClient({ baseUrl: '', fetcher: fetcher as typeof fetch })

    await expect(client.search(input as never)).rejects.toMatchObject({
      code: 'invalid_argument',
      kind: 'invalid',
      retryable: false,
    })
    expect(fetcher).not.toHaveBeenCalled()
  })

  it.each([
    { ...fixture.search, secret: 'must-not-cross' },
    { ...fixture.search, partial: 'yes' },
    { ...fixture.search, sources: [{ path: '', status: 'failed' }] },
    { ...fixture.search, sources: [{ path: '', status: 'ok', rawError: 'secret' }] },
    {
      ...fixture.search,
      items: fixture.search.items.map(item => ({
        ...item,
        source: { path: 'remote/home', baseUrl: 'https://secret.example' },
      })),
    },
  ])('fails closed on malformed federated search responses', async (response) => {
    const fetcher = vi.fn(async () => json(response))
    const client = createToolBridgeClient({ baseUrl: '', fetcher: fetcher as typeof fetch })

    await expect(client.search({ query: 'status' })).rejects.toMatchObject({
      code: 'internal',
      kind: 'protocol',
      retryable: true,
    })
  })

  it('keeps feedback detail path/detail and rejects ambiguous interior empty segments', async () => {
    const fetcher = vi.fn(async () => json(fixture.feedbackDetail))
    const client = createToolBridgeClient({
      baseUrl: 'https://gw.example',
      sk: 'tbk_fixture',
      fetcher: fetcher as typeof fetch,
    })
    expect(await client.feedback.get('system/status/get', 'fb_fixture')).toEqual(
      fixture.feedbackDetail,
    )
    await expect(client.getHelp('system//status')).rejects.toMatchObject({
      code: 'invalid_argument',
      kind: 'invalid',
    })
    await expect(client.raw({ path: '/system/status/get?admin=true' })).rejects.toMatchObject({
      code: 'invalid_argument',
      kind: 'invalid',
    })
    await expect(client.raw({ path: '/system/status/get#hidden' })).rejects.toMatchObject({
      code: 'invalid_argument',
      kind: 'invalid',
    })
    expect(fetcher).toHaveBeenCalledTimes(1)
  })

  it('cannot escape an absolute or relative base path prefix', async () => {
    const absoluteFetch = vi.fn(async (...args: Parameters<typeof fetch>) => {
      void args
      return json({ ok: true })
    })
    const absolute = createToolBridgeClient({
      baseUrl: 'https://gw.example/tenant',
      sk: 'tbk_prefix',
      fetcher: absoluteFetch as typeof fetch,
    })
    const attacks = [
      '../admin',
      '%2e%2e/admin',
      '.%2e/admin',
      '..\\admin',
      'safe/%2fadmin',
      'safe//admin',
      'safe/%5cadmin',
    ]
    for (const path of attacks) {
      await expect(absolute.raw({ path })).rejects.toMatchObject({
        code: 'invalid_argument',
        kind: 'invalid',
      })
    }
    for (const path of ['../admin', './admin', 'safe//admin']) {
      await expect(absolute.invoke(path)).rejects.toMatchObject({
        code: 'invalid_argument',
        kind: 'invalid',
      })
    }
    expect(absoluteFetch).not.toHaveBeenCalled()

    await absolute.invoke('reports/report%2F2026/a\\b')
    expect(absoluteFetch.mock.calls[0]?.[0]).toBe(
      'https://gw.example/tenant/reports/report%252F2026/a%5Cb',
    )

    const relativeFetch = vi.fn(async (...args: Parameters<typeof fetch>) => {
      void args
      return json(fixture.help)
    })
    const relative = createToolBridgeClient({
      baseUrl: '/gateway',
      sk: 'tbk_prefix',
      fetcher: relativeFetch as typeof fetch,
    })
    expect(await relative.getHelp('docs/safe')).toEqual(fixture.help)
    expect(relativeFetch.mock.calls[0]?.[0]).toBe('/gateway/docs/safe/~help')
  })

  it('rejects non-integral/overflowing timeouts and maps host timeout errors', async () => {
    expect(() => createToolBridgeClient({ baseUrl: '', timeoutMs: 1.5 })).toThrowError(
      expect.objectContaining({ code: 'invalid_argument', kind: 'invalid' }),
    )
    expect(() => createToolBridgeClient({ baseUrl: '', timeoutMs: 2_147_483_648 })).toThrowError(
      expect.objectContaining({ code: 'invalid_argument', kind: 'invalid' }),
    )

    const timeout = vi.spyOn(AbortSignal, 'timeout').mockImplementation(() => {
      throw new RangeError('host-specific timeout failure')
    })
    const client = createToolBridgeClient({
      baseUrl: '',
      fetcher: vi.fn(async () => json({ ok: true })) as typeof fetch,
    })
    await expect(client.raw({ path: '/x', timeoutMs: 1 })).rejects.toMatchObject({
      code: 'invalid_argument',
      kind: 'invalid',
    })
    timeout.mockRestore()
  })

  it.each([
    'https://gw.example/base?tenant=a',
    'https://gw.example/base#fragment',
    'mailto:ops@example.com',
    'gateway/base',
    '//evil.example',
  ])('rejects ambiguous base URL before resolving credentials or sending: %s', (baseUrl) => {
    const fetcher = vi.fn() as unknown as typeof fetch
    expect(() => createToolBridgeClient({ baseUrl, fetcher, sk: 'secret' })).toThrowError(
      expect.objectContaining({ code: 'invalid_argument', kind: 'invalid' }),
    )
    expect(fetcher).not.toHaveBeenCalled()
  })

  it.each(['', '/gateway', 'https://gw.example/base/'])(
    'accepts canonical same-origin/absolute base URL: %s',
    async (baseUrl) => {
      const fetcher = vi.fn(async () => json({ ok: true })) as unknown as typeof fetch
      const client = createToolBridgeClient({ baseUrl, fetcher, sk: 'secret' })
      await client.raw({ path: '/healthz', authenticated: false })
      expect(fetcher).toHaveBeenCalledOnce()
    },
  )

  it('strips unknown response fields and fails closed on malformed fixed responses', async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(json({ ...fixture.health, credential: 'must-not-cross' }))
      .mockResolvedValueOnce(json({ healthy: 'yes', version: 'x' }))
    const client = createToolBridgeClient({
      baseUrl: '',
      fetcher: fetcher as typeof fetch,
    })
    expect(await client.getHealth()).toEqual(fixture.health)
    await expect(client.getHealth()).rejects.toMatchObject({
      code: 'internal',
      kind: 'protocol',
      retryable: true,
    })
  })

  it('maps TBError stably and redacts the active credential', async () => {
    const fetcher = vi.fn(async () => json({
      code: 'permission_denied',
      message: 'bad Bearer tbk_secret at https://gw.example',
      retryable: false,
    }, 403))
    const client = createToolBridgeClient({
      baseUrl: 'https://gw.example',
      sk: 'tbk_secret',
      fetcher: fetcher as typeof fetch,
    })
    const error = await client.getHelp().catch(value => value) as ToolBridgeClientError
    expect(error).toMatchObject({ code: 'permission_denied', status: 403, retryable: false })
    expect(error.message).not.toContain('tbk_secret')
    expect(error.message).toContain('[REDACTED]')
  })

  it('keeps malformed HTTP 500 fallback compatible without changing canonical internal bodies', async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(new Response('proxy exploded', { status: 500 }))
      .mockResolvedValueOnce(json({ code: 'internal', message: 'safe failure', retryable: true }, 500))
    const client = createToolBridgeClient({ baseUrl: '', fetcher: fetcher as typeof fetch })
    await expect(client.getHelp()).rejects.toMatchObject({
      code: 'unavailable',
      retryable: true,
      status: 500,
    })
    await expect(client.getHelp()).rejects.toMatchObject({
      code: 'internal',
      retryable: true,
      status: 500,
    })
  })

  it('preserves caller cancellation and parses readiness 503 as a lifecycle report', async () => {
    const callerError = new DOMException('route changed', 'AbortError')
    const signal = AbortSignal.abort(callerError)
    const aborting = createToolBridgeClient({
      baseUrl: '',
      fetcher: (async (_url, init) => {
        throw init?.signal?.reason
      }) as typeof fetch,
    })
    await expect(aborting.getHelp('', { signal })).rejects.toBe(callerError)

    const readiness = createToolBridgeClient({
      baseUrl: '',
      fetcher: (async () => json({ checks: {}, ready: false }, 503)) as typeof fetch,
    })
    expect(await readiness.getReadiness()).toEqual({ checks: {}, ready: false })
  })

  it('response body 超时仍映射 timeout，不误报 network', async () => {
    const fetcher: typeof fetch = async (_input, init) => {
      let streamController: ReadableStreamDefaultController<Uint8Array> | undefined
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          streamController = controller
          controller.enqueue(new TextEncoder().encode('{"partial":'))
        },
      })
      init?.signal?.addEventListener('abort', () => {
        streamController?.error(new DOMException('host detail', 'AbortError'))
      }, { once: true })
      return new Response(stream, { headers: { 'content-type': 'application/json' } })
    }
    const client = createToolBridgeClient({ baseUrl: '', fetcher, timeoutMs: 10 })
    await expect(client.getHelp()).rejects.toMatchObject({
      kind: 'timeout',
      message: 'Tool Bridge request timed out',
      retryable: true,
    })
  })

  it('publishes the generated OpenAPI artifact without credential examples', () => {
    const serialized = JSON.stringify(fixedControlPlaneOpenApi)
    expect(fixedControlPlaneOpenApi.paths['/{commandPath}'].post.operationId).toBe('invoke')
    expect(serialized).not.toContain('tbk_')
    expect(serialized).not.toContain('Bearer example')
  })
})
