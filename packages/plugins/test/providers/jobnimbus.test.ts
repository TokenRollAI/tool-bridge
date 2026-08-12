import {
  base64urlEncode,
  type CallContext,
  encodeCallContext,
  HEADER_TB_CONTEXT,
  HEADER_TB_UPSTREAM_AUTH,
} from '@tool-bridge/core'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createJobnimbusPlugin } from '../../src/jobnimbus/index'
import { jobnimbusActions } from '../../src/jobnimbus/schema'

/**
 * JobNimbus 迁移产物的 wire 级验收。重点在几个"迁移最容易迁丢"的地方:
 * filter 的 JSON 编码、fields/skip 的逗号拼接、count 取自响应而非本页长度、
 * data 直接当请求体(不含路径参数与查询参数)。
 */

const PLUGIN_TOKEN = 'tbp_test'
const ENV = { PLUGIN_TOKEN }
const API_KEY = 'jn_test_key'
const plugin = createJobnimbusPlugin()

const CALLER: CallContext = {
  keyId: 'k1',
  owner: 'agent:tester',
  scopes: [],
  traceId: 't1',
  mountPath: 'crm/jobnimbus',
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

function mockJobnimbus(status: number, payload: unknown): ReturnType<typeof vi.fn> {
  const fn = vi.fn(() => Promise.resolve(new Response(JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json' },
  })))
  vi.stubGlobal('fetch', fn)
  return fn
}

/** 取上游收到的那个请求。 */
function sent(mock: ReturnType<typeof vi.fn>): Request {
  return (mock.mock.calls[0] as [Request])[0]
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('契约面', () => {
  it('List 出全部 8 个 action,且都带 Zod 派生的 schema', async () => {
    const res = await envelope({ tool: 'List', arguments: {} })
    const tools = (await res.json()) as Array<{ inputSchema?: unknown, name: string, outputSchema?: unknown }>
    expect(tools).toHaveLength(Object.keys(jobnimbusActions).length)
    expect(tools).toHaveLength(8)
    for (const tool of tools) {
      expect(tool.inputSchema, `${tool.name} 缺 inputSchema`).toBeDefined()
      expect(tool.outputSchema, `${tool.name} 缺 outputSchema`).toBeDefined()
    }
  })

  it('effect 播种值符合读写语义', async () => {
    const res = await envelope({ tool: 'List', arguments: {} })
    const tools = (await res.json()) as Array<{ effect?: string, name: string }>
    const effectOf = (name: string): string | undefined => tools.find(t => t.name === name)?.effect
    expect(effectOf('list_contacts')).toBe('read')
    expect(effectOf('get_job')).toBe('read')
    expect(effectOf('create_contact')).toBe('write')
    expect(effectOf('update_job')).toBe('write')
  })
})

describe('查询参数编码', () => {
  it('list:filter 走 JSON 编码,fields 逗号拼接,count 取自响应', async () => {
    const mock = mockJobnimbus(200, {
      count: 42,
      results: [{ jnid: 'c1' }, { jnid: 'c2' }],
    })
    const res = await call('list_contacts', {
      actor: 'ops@example.com',
      size: 25,
      from: 50,
      sortField: 'date_created',
      sortDirection: 'desc',
      fields: ['jnid', 'display_name'],
      filter: { must: [{ term: { status_name: 'Lead' } }] },
    })

    const request = sent(mock)
    expect(request.method).toBe('GET')
    expect(request.headers.get('authorization')).toBe(`Bearer ${API_KEY}`)
    expect(request.headers.get('accept')).toBe('application/json')
    const url = new URL(request.url)
    expect(url.origin + url.pathname).toBe('https://app.jobnimbus.com/api1/contacts')
    expect(url.searchParams.get('actor')).toBe('ops@example.com')
    expect(url.searchParams.get('size')).toBe('25')
    expect(url.searchParams.get('from')).toBe('50')
    expect(url.searchParams.get('sort_field')).toBe('date_created')
    expect(url.searchParams.get('sort_direction')).toBe('desc')
    expect(url.searchParams.get('fields')).toBe('jnid,display_name')
    expect(url.searchParams.get('filter')).toBe('{"must":[{"term":{"status_name":"Lead"}}]}')

    // count 是全量匹配数,不能被本页 results 长度覆盖。
    await expect(res.json()).resolves.toMatchObject({
      content: { count: 42, contacts: [{ jnid: 'c1' }, { jnid: 'c2' }] },
    })
  })

  it('省略的可选参数不出现在 query 里', async () => {
    const mock = mockJobnimbus(200, { count: 0, results: [] })
    await call('list_jobs', {})
    expect([...new URL(sent(mock).url).searchParams.keys()]).toEqual([])
  })
})

describe('写入与路径参数', () => {
  it('update_contact:data 原样进 body,路径参数被编码,写入控制项进 query', async () => {
    const mock = mockJobnimbus(200, { jnid: 'c/1', display_name: 'Ada' })
    const res = await call('update_contact', {
      contactId: 'c/1',
      actor: 'ops@example.com',
      bulk: true,
      skip: ['automation', 'notification'],
      data: { display_name: 'Ada', custom_field: 7 },
    })

    const request = sent(mock)
    expect(request.method).toBe('PUT')
    expect(request.headers.get('content-type')).toBe('application/json')
    const url = new URL(request.url)
    expect(url.origin + url.pathname).toBe('https://app.jobnimbus.com/api1/contacts/c%2F1')
    expect(url.searchParams.get('bulk')).toBe('true')
    expect(url.searchParams.get('skip')).toBe('automation,notification')

    // 路径参数与写入控制项都不该混进 body。
    await expect(request.json()).resolves.toEqual({ display_name: 'Ada', custom_field: 7 })
    await expect(res.json()).resolves.toMatchObject({
      content: { contact: { jnid: 'c/1' } },
    })
  })

  it('create_job 打 POST /jobs', async () => {
    const mock = mockJobnimbus(200, { jnid: 'j1' })
    await call('create_job', { data: { name: 'Roof replacement' } })
    const request = sent(mock)
    expect(request.method).toBe('POST')
    expect(new URL(request.url).pathname).toBe('/api1/jobs')
    await expect(request.json()).resolves.toEqual({ name: 'Roof replacement' })
  })
})

describe('校验与错误', () => {
  it('入参校验真的生效:sortDirection 给非枚举值 → 400 且不打上游', async () => {
    const mock = mockJobnimbus(200, {})
    const res = await call('list_contacts', { sortDirection: 'sideways' })
    expect(res.status).toBe(400)
    expect(((await res.json()) as { code: string }).code).toBe('invalid_argument')
    expect(mock).not.toHaveBeenCalled()
  })

  it('缺必填 data → 400 且不打上游', async () => {
    const mock = mockJobnimbus(200, {})
    const res = await call('create_contact', { actor: 'ops@example.com' })
    expect(res.status).toBe(400)
    expect(mock).not.toHaveBeenCalled()
  })

  it('上游错误按状态归一,消息取自 JobNimbus 的 message', async () => {
    mockJobnimbus(401, { message: 'Invalid API key' })
    await expect((await call('list_contacts', {})).json())
      .resolves.toMatchObject({ code: 'permission_denied', message: 'Invalid API key' })

    mockJobnimbus(404, { error: 'Contact not found' })
    const missing = await call('get_contact', { contactId: 'nope' })
    expect(missing.status).toBe(404)
    await expect(missing.json()).resolves.toMatchObject({
      code: 'not_found',
      message: 'Contact not found',
    })

    mockJobnimbus(429, { message: 'Rate limit exceeded' })
    await expect((await call('list_contacts', {})).json())
      .resolves.toMatchObject({ code: 'rate_limited', retryable: true })

    mockJobnimbus(500, { detail: 'JobNimbus is down' })
    await expect((await call('list_contacts', {})).json())
      .resolves.toMatchObject({ code: 'unavailable', retryable: true })
  })

  it('没配 authRef → unavailable 且不打上游', async () => {
    const mock = mockJobnimbus(200, {})
    const res = await call('list_contacts', {}, { auth: null })
    expect(res.status).toBe(503)
    expect(((await res.json()) as { message: string }).message).toContain('authRef')
    expect(mock).not.toHaveBeenCalled()
  })
})
