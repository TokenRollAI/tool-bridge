import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  ApiError,
  feedbackGet,
  getHealthz,
  getHelp,
  invoke,
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
