import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  ApiError,
  deviceOperationCancel,
  deviceOperationList,
  feedbackGet,
  getHealthz,
  getHelp,
  invoke,
  searchTools,
} from '../src/lib/api'
import fixture from '../../../test/fixtures/fixed-control-plane.json'

const conn = { baseUrl: 'https://gw.example/', sk: 'tbk_dashboard' }

function json(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('Dashboard SDK client adapter', () => {
  it('uses invoke delivery plus fixed operation management paths', async () => {
    const operation = {
      attempt: 0,
      caller: { keyId: 'sk_caller', owner: 'team-a' },
      createdAt: '2026-08-28T08:00:00.000Z',
      deviceId: 'devices/edge-1',
      executionMayHaveOccurred: false,
      expiresAt: '2026-08-29T08:00:00.000Z',
      mountPath: 'devices/edge-1',
      operationId: 'op_1',
      state: 'queued',
      targetPath: 'devices/edge-1/shell/run now',
      traceId: 'trace_1',
      updatedAt: '2026-08-28T08:00:00.000Z',
    }
    const fetcher = vi.fn(async (url: string) => json(
      url.endsWith('/~device/operations/list') ? { items: [operation] } : operation,
      url.includes('/devices/edge-1/shell/run%20now') ? 202 : 200,
    ))
    vi.stubGlobal('fetch', fetcher)

    await expect(invoke(
      conn,
      'devices/edge-1/shell/run now',
      { command: 'uptime' },
      'json',
      { delivery: 'mailbox', idempotencyKey: 'deploy-42', ttlSeconds: 90 },
    )).resolves.toMatchObject({ status: 202, json: operation })
    const [enqueueUrl, enqueueInit] = fetcher.mock.calls[0] as unknown as [string, RequestInit]
    expect(enqueueUrl).toBe(
      'https://gw.example/devices/edge-1/shell/run%20now?ttlSeconds=90',
    )
    expect(JSON.parse(String(enqueueInit.body))).toEqual({
      '~delivery': 'mailbox',
      'command': 'uptime',
    })
    expect(new Headers(enqueueInit.headers).get('x-tb-idempotency-key')).toBe('deploy-42')

    await expect(deviceOperationList(conn, 'devices/edge-1', {
      limit: 20,
      states: ['queued', 'claimed'],
    })).resolves.toEqual({ items: [operation] })
    const [listUrl, listInit] = fetcher.mock.calls[1] as unknown as [string, RequestInit]
    expect(listUrl).toBe('https://gw.example/~device/operations/list')
    expect(JSON.parse(String(listInit.body))).toEqual({
      deviceId: 'devices/edge-1',
      opts: { limit: 20, states: ['queued', 'claimed'] },
    })

    await deviceOperationCancel(conn, 'devices/edge-1', 'op_1')
    const [cancelUrl, cancelInit] = fetcher.mock.calls[2] as unknown as [string, RequestInit]
    expect(cancelUrl).toBe('https://gw.example/~device/operations/cancel')
    expect(JSON.parse(String(cancelInit.body))).toEqual({
      deviceId: 'devices/edge-1',
      operationId: 'op_1',
    })
  })

  it('validates/whitelists fixed help and keeps Dashboard Bearer transport', async () => {
    const fetcher = vi.fn(async () => json({ ...fixture.help, credential: 'must-not-cross' }))
    vi.stubGlobal('fetch', fetcher)
    expect(await getHelp(conn, 'docs/hello world')).toEqual(fixture.help)
    const [url, init] = fetcher.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('https://gw.example/docs/hello%20world/~help')
    expect(new Headers(init.headers).get('authorization')).toBe('Bearer tbk_dashboard')
    expect(init.credentials).toBe('omit')
  })

  it('preserves feedback detail path/detail from the cross-client fixture', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json(fixture.feedbackDetail)))
    expect(await feedbackGet(conn, 'system/status/get', 'fb_fixture')).toEqual(
      fixture.feedbackDetail,
    )
  })

  it('keeps dynamic HTBP full path/raw body/Accept and does not add an envelope', async () => {
    const fetcher = vi.fn(async () => json({ value: 1 }))
    vi.stubGlobal('fetch', fetcher)
    const result = await invoke(conn, '/docs/tools/run', { query: 'x' }, 'json')
    const [url, init] = fetcher.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('https://gw.example/docs/tools/run')
    expect(JSON.parse(String(init.body))).toEqual({ query: 'x' })
    expect(JSON.parse(String(init.body))).not.toHaveProperty('arguments')
    expect(new Headers(init.headers).get('accept')).toBe('application/json')
    expect(result.json).toEqual({ value: 1 })
  })

  it('sends the complete search options and accepts compact results without schemas', async () => {
    const federatedPage = {
      ...fixture.search,
      items: fixture.search.items.map(item => ({
        ...item,
        source: { path: 'regional/eu' },
      })),
      partial: true,
      sources: [
        { path: '', status: 'ok' },
        { path: 'regional/eu', status: 'timed_out' },
      ],
    }
    const fetcher = vi.fn(async () => json(federatedPage))
    vi.stubGlobal('fetch', fetcher)

    const result = await searchTools(conn, 'status', {
      detail: 'compact',
      effects: ['read', 'unknown'],
      federation: 'recursive',
      limit: 10,
      matching: 'best',
      minCoverage: 0.75,
      mode: 'keyword',
      pathPrefix: 'system',
    })

    const [url, init] = fetcher.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('https://gw.example/~search')
    expect(JSON.parse(String(init.body))).toEqual({
      query: 'status',
      opts: {
        detail: 'compact',
        effects: ['read', 'unknown'],
        federation: 'recursive',
        limit: 10,
        matching: 'best',
        minCoverage: 0.75,
        mode: 'keyword',
        pathPrefix: 'system',
      },
    })
    expect(result).toEqual(federatedPage)
    expect(result.items[0]?.tool).not.toHaveProperty('inputSchema')
    expect(result.items[0]?.source).toEqual({ path: 'regional/eu' })
    expect(result).toMatchObject({
      partial: true,
      sources: [{ path: '', status: 'ok' }, { path: 'regional/eu', status: 'timed_out' }],
    })
  })

  it('localizes network errors, preserves caller AbortError and validates public health', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => {
      throw new TypeError('fetch failed for https://gw.example?token=secret')
    }))
    await expect(getHelp(conn, '')).rejects.toMatchObject({
      code: 'network',
      message: '网络请求失败:网关不可达或跨域未放行',
      retryable: true,
    } satisfies Partial<ApiError>)

    const aborted = new DOMException('route changed', 'AbortError')
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init: RequestInit) => {
      throw init.signal?.reason
    }))
    await expect(getHelp(conn, '', AbortSignal.abort(aborted))).rejects.toBe(aborted)

    const healthFetch = vi.fn(async () => json(fixture.health))
    vi.stubGlobal('fetch', healthFetch)
    expect(await getHealthz('https://gw.example')).toEqual(fixture.health)
    const [, init] = healthFetch.mock.calls[0] as unknown as [string, RequestInit]
    expect(new Headers(init.headers).has('authorization')).toBe(false)
  })
})
