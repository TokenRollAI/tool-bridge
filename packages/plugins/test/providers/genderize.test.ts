import {
  base64urlEncode,
  type CallContext,
  encodeCallContext,
  HEADER_TB_CONTEXT,
  HEADER_TB_UPSTREAM_AUTH,
} from '@tool-bridge/core'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createGenderizePlugin } from '../../src/genderize/index'
import { genderizeActions } from '../../src/genderize/schema'

/**
 * Genderize 迁移产物的 wire 级验收。重点在几个"迁移最容易迁丢"的地方:
 * key 走 query、单/批量共用同一端点(`name` vs `name[]`)、402 归到 rate_limited、
 * 批量条数与入参对齐的检查。
 */

const PLUGIN_TOKEN = 'tbp_test'
const ENV = { PLUGIN_TOKEN }
const API_KEY = 'genderize_deadbeef'
const plugin = createGenderizePlugin()

const CALLER: CallContext = {
  keyId: 'k1',
  owner: 'agent:tester',
  scopes: [],
  traceId: 't1',
  mountPath: 'data/genderize',
  exportId: 'actions',
}

function envelope(body: unknown, opts: { auth?: string | null } = {}): Promise<Response> {
  const headers: Record<string, string> = {
    'authorization': `Bearer ${PLUGIN_TOKEN}`,
    'content-type': 'application/json',
    [HEADER_TB_CONTEXT]: encodeCallContext(CALLER),
  }
  const auth = opts.auth === undefined ? API_KEY : opts.auth
  if (auth !== null) {
    headers[HEADER_TB_UPSTREAM_AUTH] = base64urlEncode(new TextEncoder().encode(auth))
  }
  return Promise.resolve(plugin.fetch(
    new Request('https://plugin.test/', { method: 'POST', headers, body: JSON.stringify(body) }),
    ENV as never,
  ))
}

function call(name: string, args: unknown, opts?: { auth?: string | null }): Promise<Response> {
  return envelope({ tool: 'Call', arguments: { name, args } }, opts)
}

function mockGenderize(status: number, payload: unknown): ReturnType<typeof vi.fn> {
  const fn = vi.fn(() => Promise.resolve(new Response(JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json' },
  })))
  vi.stubGlobal('fetch', fn)
  return fn
}

function sent(mock: ReturnType<typeof vi.fn>): Request {
  return (mock.mock.calls[0] as [Request])[0]
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('契约面', () => {
  it('List 出全部 2 个 action,且都带 Zod 派生的 schema', async () => {
    const res = await envelope({ tool: 'List', arguments: {} })
    const tools = (await res.json()) as Array<{ inputSchema?: unknown, name: string, outputSchema?: unknown }>
    expect(tools).toHaveLength(Object.keys(genderizeActions).length)
    expect(tools).toHaveLength(2)
    for (const tool of tools) {
      expect(tool.inputSchema, `${tool.name} 缺 inputSchema`).toBeDefined()
      expect(tool.outputSchema, `${tool.name} 缺 outputSchema`).toBeDefined()
    }
  })
})

describe('请求成形', () => {
  it('单个查询用 name=,key 进 query 而非 header', async () => {
    const mock = mockGenderize(200, { name: 'peter', gender: 'male', probability: 0.99, count: 1000 })
    const res = await call('predict_gender', { name: 'peter', country_id: 'US' })

    const request = sent(mock)
    const url = new URL(request.url)
    expect(url.origin).toBe('https://api.genderize.io')
    expect(url.searchParams.get('apikey')).toBe(API_KEY)
    expect(url.searchParams.get('name')).toBe('peter')
    expect(url.searchParams.get('country_id')).toBe('US')
    expect(request.headers.get('authorization')).toBeNull()
    await expect(res.json()).resolves.toEqual({
      content: { name: 'peter', gender: 'male', probability: 0.99, count: 1000 },
    })
  })

  it('批量查询打同一端点,只是换成重复的 name[]', async () => {
    const mock = mockGenderize(200, [
      { name: 'peter', gender: 'male', probability: 0.99, count: 1000 },
      { name: 'lois', gender: 'female', probability: 0.97, count: 500 },
    ])
    const res = await call('predict_gender_batch', { names: ['peter', 'lois'] })

    const url = new URL(sent(mock).url)
    expect(url.origin).toBe('https://api.genderize.io')
    expect(url.searchParams.getAll('name[]')).toEqual(['peter', 'lois'])
    expect(url.searchParams.has('name')).toBe(false)
    await expect(res.json()).resolves.toMatchObject({
      content: { predictions: [{ name: 'peter' }, { name: 'lois' }] },
    })
  })
})

describe('响应归一', () => {
  it('gender 为 null 是合法结果(库里没这个名字)', async () => {
    mockGenderize(200, { name: 'zzzz', gender: null, probability: 0, count: 0 })
    await expect((await call('predict_gender', { name: 'zzzz' })).json())
      .resolves.toEqual({ content: { name: 'zzzz', gender: null, probability: 0, count: 0 } })
  })

  it('缺 probability/count,或 gender 取值不认识 → unavailable', async () => {
    mockGenderize(200, { name: 'peter', gender: 'male', count: 10 })
    await expect((await call('predict_gender', { name: 'peter' })).json())
      .resolves.toMatchObject({ code: 'unavailable' })

    mockGenderize(200, { name: 'peter', gender: 'unknown', probability: 0.5, count: 10 })
    await expect((await call('predict_gender', { name: 'peter' })).json())
      .resolves.toMatchObject({ code: 'unavailable' })
  })

  it('批量返回条数与入参不符 → unavailable(结果按下标对齐,少一条就全错位)', async () => {
    mockGenderize(200, [{ name: 'peter', gender: 'male', probability: 0.99, count: 1000 }])
    const res = await call('predict_gender_batch', { names: ['peter', 'lois'] })
    await expect(res.json()).resolves.toMatchObject({ code: 'unavailable' })
  })
})

describe('校验与错误', () => {
  it('入参校验真的生效:names 超过 10 个 → 400 且不打上游', async () => {
    const mock = mockGenderize(200, [])
    const res = await call('predict_gender_batch', {
      names: Array.from({ length: 11 }, (_, i) => `n${i}`),
    })
    expect(res.status).toBe(400)
    expect(((await res.json()) as { code: string }).code).toBe('invalid_argument')
    expect(mock).not.toHaveBeenCalled()
  })

  it('入参校验真的生效:country_id 不是大写两位 → 400 且不打上游', async () => {
    const mock = mockGenderize(200, {})
    const res = await call('predict_gender', { name: 'peter', country_id: 'usa' })
    expect(res.status).toBe(400)
    expect(mock).not.toHaveBeenCalled()
  })

  it('上游错误按状态归一,402(额度用完)也归到 rate_limited', async () => {
    mockGenderize(401, { error: 'Invalid API key' })
    const denied = await call('predict_gender', { name: 'peter' })
    expect(denied.status).toBe(401)
    await expect(denied.json()).resolves.toMatchObject({
      code: 'permission_denied',
      message: 'Invalid API key',
    })

    mockGenderize(429, { error: 'Request limit reached' })
    await expect((await call('predict_gender', { name: 'peter' })).json())
      .resolves.toMatchObject({ code: 'rate_limited', retryable: true })

    mockGenderize(402, { error: 'Subscription is not active' })
    await expect((await call('predict_gender', { name: 'peter' })).json())
      .resolves.toMatchObject({ code: 'rate_limited', retryable: true })

    mockGenderize(500, { error: 'Genderize is down' })
    await expect((await call('predict_gender', { name: 'peter' })).json())
      .resolves.toMatchObject({ code: 'unavailable', retryable: true })
  })

  it('没配 authRef → unavailable 且不打上游', async () => {
    const mock = mockGenderize(200, {})
    const res = await call('predict_gender', { name: 'peter' }, { auth: null })
    expect(res.status).toBe(503)
    expect(((await res.json()) as { message: string }).message).toContain('authRef')
    expect(mock).not.toHaveBeenCalled()
  })
})
