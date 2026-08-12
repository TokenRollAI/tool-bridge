import {
  base64urlEncode,
  type CallContext,
  encodeCallContext,
  HEADER_TB_CONTEXT,
  HEADER_TB_UPSTREAM_AUTH,
} from '@tool-bridge/core'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createTemplatedPlugin } from '../../src/templated/index'
import { templatedActions } from '../../src/templated/schema'

/**
 * Templated 迁移产物的 wire 级验收。重点在两处最容易迁丢的地方:create_render 请求体
 * 的键名重写(templateId → template),以及列表响应的三种形状归一。
 */

const PLUGIN_TOKEN = 'tbp_test'
const ENV = { PLUGIN_TOKEN }
const API_KEY = 'tpl_live_deadbeef'
const plugin = createTemplatedPlugin()

const CALLER: CallContext = {
  keyId: 'k1',
  owner: 'agent:tester',
  scopes: [],
  traceId: 't1',
  mountPath: 'media/templated',
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

function mockTemplated(status: number, payload: unknown): ReturnType<typeof vi.fn> {
  // 204 不能带 body(Response 构造器会拒);delete_render 正是这条路径。
  const body = status === 204 ? null : JSON.stringify(payload)
  const fn = vi.fn(() => Promise.resolve(new Response(body, {
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
  it('List 出全部 7 个 action,且都带 Zod 派生的 schema', async () => {
    const res = await envelope({ tool: 'List', arguments: {} })
    const tools = (await res.json()) as Array<{ inputSchema?: unknown, name: string, outputSchema?: unknown }>
    expect(tools).toHaveLength(Object.keys(templatedActions).length)
    expect(tools).toHaveLength(7)
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
    expect(effectOf('create_render')).toBe('write')
    expect(effectOf('delete_render')).toBe('destructive')
  })
})

describe('请求构造', () => {
  it('create_render 把入参重命名成 Templated 的字段名', async () => {
    const mock = mockTemplated(200, { id: 'r1', url: 'https://cdn.templated.io/r1.png', status: 'COMPLETED' })
    const res = await call('create_render', {
      templateId: 'tpl_1',
      format: 'png',
      externalId: 'ext-9',
      webhookUrl: 'https://hooks.example.com/done',
      scale: 1.5,
      layers: { title: { text: 'Hello' } },
    })

    const request = sent(mock)
    expect(request.url).toBe('https://api.templated.io/v1/render')
    expect(request.method).toBe('POST')
    expect(request.headers.get('authorization')).toBe(`Bearer ${API_KEY}`)
    expect(request.headers.get('content-type')).toBe('application/json')
    expect(request.headers.get('user-agent')).toBeNull()
    await expect(request.json()).resolves.toEqual({
      template: 'tpl_1',
      format: 'png',
      external_id: 'ext-9',
      webhook_url: 'https://hooks.example.com/done',
      scale: 1.5,
      layers: { title: { text: 'Hello' } },
    })
    // 非数组、无 data 的响应被当成单条 render。
    await expect(res.json()).resolves.toMatchObject({
      content: { renders: [{ id: 'r1', url: 'https://cdn.templated.io/r1.png', status: 'COMPLETED' }] },
    })
  })

  it('list_templates 的 tags 序列化成逗号串,布尔进 query', async () => {
    const mock = mockTemplated(200, { data: [{ id: 't1', name: 'Card' }] })
    await call('list_templates', { tags: ['ads', 'social'], includeLayers: true, page: 0, limit: 10 })

    const url = new URL(sent(mock).url)
    expect(url.origin + url.pathname).toBe('https://api.templated.io/v1/templates')
    expect(url.searchParams.get('tags')).toBe('ads,social')
    expect(url.searchParams.get('includeLayers')).toBe('true')
    expect(url.searchParams.get('page')).toBe('0')
    expect(url.searchParams.get('limit')).toBe('10')
    expect(url.searchParams.has('query')).toBe(false)
  })

  it('路径参数被 URL 编码', async () => {
    const mock = mockTemplated(200, { id: 'a/b', name: 'X' })
    await call('get_template', { templateId: 'a/b' })
    expect(sent(mock).url).toBe('https://api.templated.io/v1/template/a%2Fb')
  })

  it('delete_render 走 DELETE,回声 renderId', async () => {
    const mock = mockTemplated(204, null)
    const res = await call('delete_render', { renderId: 'r9' })
    expect(sent(mock).method).toBe('DELETE')
    await expect(res.json()).resolves.toEqual({ content: { deleted: true, renderId: 'r9' } })
  })
})

describe('响应归一', () => {
  it('列表的三种形状(裸数组 / data / 复数键)都收', async () => {
    mockTemplated(200, [{ id: 't1', name: 'A' }])
    await expect((await call('list_templates', {})).json())
      .resolves.toMatchObject({ content: { templates: [{ id: 't1', name: 'A' }] } })

    mockTemplated(200, { renders: [{ id: 'r1' }] })
    await expect((await call('list_renders', {})).json())
      .resolves.toMatchObject({ content: { renders: [{ id: 'r1' }] } })
  })

  it('get_account 会从顶层与 user 两处取字段', async () => {
    mockTemplated(200, { user: { id: 'u1', name: 'Ada' }, plan: 'pro', watermark: false })
    await expect((await call('get_account', {})).json()).resolves.toMatchObject({
      content: { account: { id: 'u1', name: 'Ada', plan: 'pro', watermark: false } },
    })
  })
})

describe('校验与错误', () => {
  it('入参校验生效:scale 超出范围 → 400 且不打上游', async () => {
    const mock = mockTemplated(200, {})
    const res = await call('create_render', { templateId: 'tpl_1', scale: 9 })
    expect(res.status).toBe(400)
    expect(((await res.json()) as { code: string }).code).toBe('invalid_argument')
    expect(mock).not.toHaveBeenCalled()
  })

  it('缺必填 templateId → 400 且不打上游', async () => {
    const mock = mockTemplated(200, {})
    expect((await call('get_template', {})).status).toBe(400)
    expect(mock).not.toHaveBeenCalled()
  })

  it('上游错误按状态归一,消息取自 message/error/detail', async () => {
    mockTemplated(401, { message: 'Invalid API key' })
    const unauth = await call('get_account', {})
    expect(unauth.status).toBe(401)
    await expect(unauth.json()).resolves.toMatchObject({
      code: 'permission_denied',
      message: 'Invalid API key',
    })

    mockTemplated(429, { error: 'Rate limit exceeded' })
    await expect((await call('list_renders', {})).json())
      .resolves.toMatchObject({ code: 'rate_limited', retryable: true })

    // 上游把单实体的 404 压成 400;迁移后保留 not_found。
    mockTemplated(404, { detail: 'Render not found' })
    await expect((await call('get_render', { renderId: 'nope' })).json())
      .resolves.toMatchObject({ code: 'not_found', message: 'Render not found' })

    mockTemplated(500, { message: 'boom' })
    await expect((await call('list_renders', {})).json())
      .resolves.toMatchObject({ code: 'unavailable', retryable: true })
  })

  it('没配 authRef → unavailable 且不打上游', async () => {
    const mock = mockTemplated(200, {})
    const res = await call('get_account', {}, { auth: null })
    expect(res.status).toBe(503)
    expect(((await res.json()) as { message: string }).message).toContain('authRef')
    expect(mock).not.toHaveBeenCalled()
  })
})
