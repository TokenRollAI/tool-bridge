import {
  base64urlEncode,
  type CallContext,
  encodeCallContext,
  HEADER_TB_CONTEXT,
  HEADER_TB_UPSTREAM_AUTH,
} from '@tool-bridge/core'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod/v4'
import { createRiveterPlugin } from '../../src/riveter/index'
import { riveterActions } from '../../src/riveter/schema'

/**
 * Riveter 迁移产物的 wire 级验收。重点在几个"迁移最容易迁丢"的地方:
 * base URL 里 /v1 前缀不能被 `new URL` 吃掉、scrape 响应的必填字段校验、
 * 可选字段缺失时整键省掉(而非补 null)。
 */

const PLUGIN_TOKEN = 'tbp_test'
const ENV = { PLUGIN_TOKEN }
const API_KEY = 'rvt_deadbeef'
const plugin = createRiveterPlugin()

const CALLER: CallContext = {
  keyId: 'k1',
  owner: 'agent:tester',
  scopes: [],
  traceId: 't1',
  mountPath: 'scrape/riveter',
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

function mockRiveter(status: number, payload: unknown): ReturnType<typeof vi.fn> {
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

const SCRAPE_OK = {
  request_status: 'success',
  message: 'ok',
  run_key: 'run_1',
  data: {
    url: 'https://example.com',
    text: 'Hello world',
    base_url_for_links: 'https://example.com/',
    status_code: 200,
    possibly_blocked: false,
    credit_used: 1,
    riveter_app_link: 'https://app.riveterhq.com/runs/run_1',
  },
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('契约面', () => {
  it('List 出全部 2 个 action,且都带 Zod 派生的 schema', async () => {
    const res = await envelope({ tool: 'List', arguments: {} })
    const tools = (await res.json()) as Array<{ inputSchema?: unknown, name: string, outputSchema?: unknown }>
    expect(tools).toHaveLength(Object.keys(riveterActions).length)
    expect(tools).toHaveLength(2)
    for (const tool of tools) {
      expect(tool.inputSchema, `${tool.name} 缺 inputSchema`).toBeDefined()
      expect(tool.outputSchema, `${tool.name} 缺 outputSchema`).toBeDefined()
    }
  })

  it('effect 播种值符合读写语义', async () => {
    const res = await envelope({ tool: 'List', arguments: {} })
    const tools = (await res.json()) as Array<{ effect?: string, name: string }>
    const effectOf = (name: string): string | undefined => tools.find(t => t.name === name)?.effect
    expect(effectOf('get_account')).toBe('read')
    // 消耗抓取额度,不是纯读。
    expect(effectOf('scrape')).toBe('write')
  })
})

describe('请求成形', () => {
  it('get_account:GET /v1/account,凭证走 Bearer,/v1 前缀保留', async () => {
    const mock = mockRiveter(200, { account: { name: 'Acme', plan: 'pro' } })
    const res = await call('get_account', {})

    const request = sent(mock)
    expect(request.url).toBe('https://api.riveterhq.com/v1/account')
    expect(request.method).toBe('GET')
    expect(request.headers.get('authorization')).toBe(`Bearer ${API_KEY}`)
    await expect(res.json()).resolves.toMatchObject({
      content: { account: { name: 'Acme', plan: 'pro' } },
    })
  })

  it('scrape:POST + JSON body,省略的可选字段不进 body', async () => {
    const mock = mockRiveter(200, SCRAPE_OK)
    const res = await call('scrape', { url: 'https://example.com', skip_cache: true })

    const request = sent(mock)
    expect(request.url).toBe('https://api.riveterhq.com/v1/scrape')
    expect(request.method).toBe('POST')
    expect(request.headers.get('content-type')).toBe('application/json')
    await expect(request.json()).resolves.toEqual({
      url: 'https://example.com',
      skip_cache: true,
    })

    await expect(res.json()).resolves.toMatchObject({
      content: {
        request_status: 'success',
        run_key: 'run_1',
        data: { text: 'Hello world', credit_used: 1, status_code: 200 },
      },
    })
  })

  it('scrape:data.raw 保留上游原始对象', async () => {
    mockRiveter(200, SCRAPE_OK)
    const body = (await (await call('scrape', { url: 'https://example.com' })).json()) as {
      content: { data: { raw: unknown } }
    }
    expect(body.content.data.raw).toEqual(SCRAPE_OK.data)
  })

  it('可选响应字段缺失时整键省掉(不补 null)', async () => {
    mockRiveter(200, {
      ...SCRAPE_OK,
      data: {
        url: 'https://example.com',
        text: 'Hi',
        base_url_for_links: 'https://example.com/',
        credit_used: 1,
        riveter_app_link: 'https://app.riveterhq.com/runs/run_1',
      },
    })
    const body = (await (await call('scrape', { url: 'https://example.com' })).json()) as {
      content: { data: Record<string, unknown> }
    }
    expect(body.content.data).not.toHaveProperty('status_code')
    expect(body.content.data).not.toHaveProperty('possibly_blocked')
  })
})

describe('校验与错误', () => {
  it('入参校验真的生效:url 给非 URL → 400 且不打上游', async () => {
    const mock = mockRiveter(200, {})
    const res = await call('scrape', { url: 'not-a-url' })
    expect(res.status).toBe(400)
    expect(((await res.json()) as { code: string }).code).toBe('invalid_argument')
    expect(mock).not.toHaveBeenCalled()
  })

  it('proxy_country_code 不是两位小写 → 400 且不打上游', async () => {
    const mock = mockRiveter(200, {})
    const res = await call('scrape', { url: 'https://example.com', proxy_country_code: 'USA' })
    expect(res.status).toBe(400)
    expect(mock).not.toHaveBeenCalled()
  })

  it('scrape 响应缺必填字段 → unavailable(上游破契约,不赖调用方)', async () => {
    mockRiveter(200, { ...SCRAPE_OK, data: { ...SCRAPE_OK.data, text: '' } })
    const res = await call('scrape', { url: 'https://example.com' })
    expect(res.status).toBe(503)
    expect(((await res.json()) as { message: string }).message).toContain('data.text')
  })

  it('上游错误按状态归一,消息取自 message', async () => {
    mockRiveter(401, { message: 'Invalid API key' })
    const unauth = await call('get_account', {})
    expect(unauth.status).toBe(401)
    await expect(unauth.json()).resolves.toMatchObject({
      code: 'permission_denied',
      message: 'Invalid API key',
    })

    mockRiveter(429, { message: 'Out of credits' })
    await expect((await call('get_account', {})).json())
      .resolves.toMatchObject({ code: 'rate_limited', retryable: true })

    mockRiveter(500, { message: 'Riveter is down' })
    await expect((await call('get_account', {})).json())
      .resolves.toMatchObject({ code: 'unavailable', retryable: true })
  })

  it('没配 authRef → unavailable 且不打上游', async () => {
    const mock = mockRiveter(200, {})
    const res = await call('get_account', {}, { auth: null })
    expect(res.status).toBe(503)
    expect(((await res.json()) as { message: string }).message).toContain('authRef')
    expect(mock).not.toHaveBeenCalled()
  })
})

describe('凭证探针(credentialProbe)', () => {
  it('~describe 报出探针工具名,平台据此在挂载时验凭证', async () => {
    const res = await createRiveterPlugin().fetch(
      new Request('https://p.test/~describe'),
      {} as never,
    )
    const body = (await res.json()) as { exports: Array<{ credentialProbe?: string, id: string }> }
    expect(body.exports[0]?.credentialProbe).toBe('get_account')
  })

  it('探针指向的工具确实存在、只读、且无必填入参(平台挂载时会空参调它)', async () => {
    const spec = riveterActions.get_account
    expect(spec.effect).toBe('read')
    const schema = z.toJSONSchema(spec.inputSchema, { io: 'input' }) as { required?: string[] }
    expect(schema.required ?? []).toEqual([])
  })
})
