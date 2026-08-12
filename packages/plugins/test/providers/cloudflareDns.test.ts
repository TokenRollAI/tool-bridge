import {
  base64urlEncode,
  type CallContext,
  encodeCallContext,
  HEADER_TB_CONTEXT,
  HEADER_TB_UPSTREAM_AUTH,
} from '@tool-bridge/core'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createCloudflareDnsPlugin } from '../../src/cloudflare_dns/index'
import { cloudflareDnsActions } from '../../src/cloudflare_dns/schema'

/**
 * Cloudflare DNS 迁移产物的 wire 级验收。重点在几个"迁移最容易迁丢"的地方:
 * 信封式失败(HTTP 200 + `success: false`)、两条只存在于 refine 里的组合约束、
 * 写请求体里 `content`/`comment` 原样发而 `name` 去空白、以及 snake_case → camelCase 的裁剪。
 */

const PLUGIN_TOKEN = 'tbp_test'
const ENV = { PLUGIN_TOKEN }
const API_TOKEN = 'cf_token_deadbeef'
const ZONE = 'zone123'
const RECORD = 'rec456'
const plugin = createCloudflareDnsPlugin()

const CALLER: CallContext = {
  keyId: 'k1',
  owner: 'agent:tester',
  scopes: [],
  traceId: 't1',
  mountPath: 'dns/cloudflare',
  exportId: 'actions',
}

function envelope(body: unknown, opts: { auth?: string | null } = {}): Promise<Response> {
  const headers: Record<string, string> = {
    'authorization': `Bearer ${PLUGIN_TOKEN}`,
    'content-type': 'application/json',
    [HEADER_TB_CONTEXT]: encodeCallContext(CALLER),
  }
  const auth = opts.auth === undefined ? API_TOKEN : opts.auth
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

/** Cloudflare 的响应总是信封;`success` 缺省按成功给。 */
function mockCloudflare(status: number, payload: unknown): ReturnType<typeof vi.fn> {
  const fn = vi.fn(() => Promise.resolve(new Response(JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json' },
  })))
  vi.stubGlobal('fetch', fn)
  return fn
}

function mockRaw(status: number, body: string): ReturnType<typeof vi.fn> {
  const fn = vi.fn(() => Promise.resolve(new Response(body, { status })))
  vi.stubGlobal('fetch', fn)
  return fn
}

function sent(mock: ReturnType<typeof vi.fn>): Request {
  return (mock.mock.calls[0] as [Request])[0]
}

const DNS_RECORD = {
  id: RECORD,
  zone_id: ZONE,
  zone_name: 'example.com',
  type: 'A',
  name: 'www.example.com',
  content: '203.0.113.4',
  ttl: 3600,
  proxied: true,
  proxiable: true,
  comment: null,
  tags: ['edge', 42],
  created_on: '2024-01-01T00:00:00Z',
  modified_on: '2024-01-02T00:00:00Z',
  meta: { auto_added: false },
  unknown_field: 'dropped',
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('契约面', () => {
  it('List 出全部 8 个 action,且都带 Zod 派生的 schema', async () => {
    const res = await envelope({ tool: 'List', arguments: {} })
    const tools = (await res.json()) as Array<{ inputSchema?: unknown, name: string, outputSchema?: unknown }>
    expect(tools).toHaveLength(Object.keys(cloudflareDnsActions).length)
    expect(tools).toHaveLength(8)
    expect(tools.map(tool => tool.name).sort()).toEqual([
      'create_dns_record',
      'delete_dns_record',
      'get_dns_record',
      'get_zone',
      'list_accounts',
      'list_dns_records',
      'list_zones',
      'update_dns_record',
    ])
    for (const tool of tools) {
      expect(tool.inputSchema, `${tool.name} 缺 inputSchema`).toBeDefined()
      expect(tool.outputSchema, `${tool.name} 缺 outputSchema`).toBeDefined()
    }
  })
})

describe('请求拼装', () => {
  it('list_zones:凭证走 Bearer 头,过滤键是带点的 account.id,GET 无请求体', async () => {
    const mock = mockCloudflare(200, { success: true, result: [] })
    await call('list_zones', {
      page: 2,
      perPage: 10,
      name: 'example.com',
      accountId: 'acc1',
      match: 'all',
      direction: 'desc',
    })

    const request = sent(mock)
    const url = new URL(request.url)
    expect(request.method).toBe('GET')
    expect(url.origin).toBe('https://api.cloudflare.com')
    expect(url.pathname).toBe('/client/v4/zones')
    expect(request.headers.get('authorization')).toBe(`Bearer ${API_TOKEN}`)
    expect(request.headers.get('accept')).toBe('application/json')
    // GET 不该带 content-type —— 上游只在有 body 时才加。
    expect(request.headers.get('content-type')).toBeNull()
    expect(await request.text()).toBe('')
    expect(Object.fromEntries(url.searchParams)).toEqual({
      'page': '2',
      'per_page': '10',
      'name': 'example.com',
      'account.id': 'acc1',
      'match': 'all',
      'direction': 'desc',
    })
  })

  it('list_accounts 的分页有缺省值,总是发出去(不是"没给就不发")', async () => {
    const mock = mockCloudflare(200, { success: true, result: [] })
    await call('list_accounts', {})
    expect(Object.fromEntries(new URL(sent(mock).url).searchParams)).toEqual({ page: '1', per_page: '50' })
  })

  it('未给的可选过滤不出现在 query 里,空白串按"没给"处理', async () => {
    const mock = mockCloudflare(200, { success: true, result: [] })
    await call('list_dns_records', { zoneId: ZONE, name: '   ', type: 'MX' })
    const url = new URL(sent(mock).url)
    expect(url.pathname).toBe(`/client/v4/zones/${ZONE}/dns_records`)
    expect(Object.fromEntries(url.searchParams)).toEqual({ type: 'MX' })
  })

  it('路径段被 encodeURIComponent 转义(zone id 来自调用方,不能直接拼进路径)', async () => {
    const mock = mockCloudflare(200, { success: true, result: DNS_RECORD })
    await call('get_dns_record', { zoneId: 'a/b', dnsRecordId: 'c d' })
    expect(new URL(sent(mock).url).pathname).toBe('/client/v4/zones/a%2Fb/dns_records/c%20d')
  })

  it('create_dns_record:POST + JSON body,content/comment 原样发而 name 去空白', async () => {
    const mock = mockCloudflare(200, { success: true, result: DNS_RECORD })
    await call('create_dns_record', {
      zoneId: ZONE,
      type: 'TXT',
      name: '  www.example.com  ',
      content: 'v=spf1 -all',
      comment: '',
      ttl: 1,
      tags: ['edge'],
    })

    const request = sent(mock)
    expect(request.method).toBe('POST')
    expect(new URL(request.url).pathname).toBe(`/client/v4/zones/${ZONE}/dns_records`)
    expect(request.headers.get('content-type')).toBe('application/json')
    // zoneId 只进路径,不进 body;comment 的空串要留住(清空一个字段就靠它)。
    await expect(request.json()).resolves.toEqual({
      type: 'TXT',
      name: 'www.example.com',
      content: 'v=spf1 -all',
      comment: '',
      ttl: 1,
      tags: ['edge'],
    })
  })

  it('update_dns_record 是 PATCH,只发给到的字段', async () => {
    const mock = mockCloudflare(200, { success: true, result: DNS_RECORD })
    await call('update_dns_record', { zoneId: ZONE, dnsRecordId: RECORD, ttl: 120 })
    const request = sent(mock)
    expect(request.method).toBe('PATCH')
    expect(new URL(request.url).pathname).toBe(`/client/v4/zones/${ZONE}/dns_records/${RECORD}`)
    await expect(request.json()).resolves.toEqual({ ttl: 120 })
  })

  it('delete_dns_record 是 DELETE,回一个明确的确认而不是上游原文', async () => {
    const mock = mockCloudflare(200, { success: true, result: { id: RECORD } })
    const res = await call('delete_dns_record', { zoneId: ZONE, dnsRecordId: RECORD })
    expect(sent(mock).method).toBe('DELETE')
    await expect(res.json()).resolves.toEqual({ content: { id: RECORD, deleted: true } })
  })
})

describe('响应整形', () => {
  it('DNS 记录:snake_case 改名成 camelCase,未声明字段丢掉,null 保留', async () => {
    mockCloudflare(200, { success: true, result: DNS_RECORD })
    const res = await call('get_dns_record', { zoneId: ZONE, dnsRecordId: RECORD })
    await expect(res.json()).resolves.toEqual({
      content: {
        record: {
          id: RECORD,
          zoneId: ZONE,
          zoneName: 'example.com',
          type: 'A',
          name: 'www.example.com',
          content: '203.0.113.4',
          ttl: 3600,
          proxied: true,
          proxiable: true,
          // comment 是 null:上游明确说"这条记录没有备注",与字段缺席不是一回事。
          comment: null,
          // tags 里的非字符串项丢掉。
          tags: ['edge'],
          createdOn: '2024-01-01T00:00:00Z',
          modifiedOn: '2024-01-02T00:00:00Z',
          meta: { auto_added: false },
        },
      },
    })
  })

  it('list_zones 展开 result 与 result_info', async () => {
    mockCloudflare(200, {
      success: true,
      result: [{ id: ZONE, name: 'example.com', status: 'active', account: { id: 'acc1', name: 'Acme' } }],
      result_info: { page: 1, per_page: 20, count: 1, total_count: 1, total_pages: 1 },
    })
    const res = await call('list_zones', {})
    await expect(res.json()).resolves.toEqual({
      content: {
        zones: [{
          id: ZONE,
          name: 'example.com',
          status: 'active',
          account: { id: 'acc1', name: 'Acme' },
        }],
        resultInfo: { page: 1, perPage: 20, count: 1, totalCount: 1, totalPages: 1 },
      },
    })
  })

  it('没有 result_info 时不硬造这个键', async () => {
    mockCloudflare(200, { success: true, result: [{ id: 'acc1', name: 'Acme' }] })
    const res = await call('list_accounts', {})
    await expect(res.json()).resolves.toEqual({ content: { accounts: [{ id: 'acc1', name: 'Acme' }] } })
  })
})

describe('校验与错误', () => {
  it('create 的 content/data 二选一在本地就拦下(refine),不打上游', async () => {
    const mock = mockCloudflare(200, { success: true, result: DNS_RECORD })
    const res = await call('create_dns_record', { zoneId: ZONE, type: 'A', name: 'www.example.com' })
    expect(res.status).toBe(400)
    await expect(res.json()).resolves.toMatchObject({ code: 'invalid_argument' })
    expect(mock).not.toHaveBeenCalled()

    // 给了 data(结构化记录用的形态)就该放行 —— 上游不按记录类型区分 content/data。
    vi.unstubAllGlobals()
    const ok = mockCloudflare(200, { success: true, result: DNS_RECORD })
    await call('create_dns_record', { zoneId: ZONE, type: 'MX', name: 'example.com', data: { priority: 10 } })
    expect(ok).toHaveBeenCalledOnce()
  })

  it('update 的"至少改一个字段"在本地就拦下,空 PATCH 不打上游', async () => {
    const mock = mockCloudflare(200, { success: true, result: DNS_RECORD })
    const res = await call('update_dns_record', { zoneId: ZONE, dnsRecordId: RECORD })
    expect(res.status).toBe(400)
    await expect(res.json()).resolves.toMatchObject({ code: 'invalid_argument' })
    expect(mock).not.toHaveBeenCalled()
  })

  it('入参校验真的生效:未知记录类型 → 400 且不打上游', async () => {
    const mock = mockCloudflare(200, {})
    const res = await call('list_dns_records', { zoneId: ZONE, type: 'NOPE' })
    expect(res.status).toBe(400)
    expect(((await res.json()) as { code: string }).code).toBe('invalid_argument')
    expect(mock).not.toHaveBeenCalled()
  })

  it('HTTP 200 + success:false 是失败,不能当成功返回(信封式错误)', async () => {
    mockCloudflare(200, {
      success: false,
      errors: [{ code: 81044, message: 'Record does not exist.' }],
      result: null,
    })
    const res = await call('get_dns_record', { zoneId: ZONE, dnsRecordId: RECORD })
    expect(res.status).toBe(400)
    await expect(res.json()).resolves.toMatchObject({
      code: 'invalid_argument',
      message: 'Record does not exist.',
    })
  })

  it('errors 里没有 message 时退到 messages,都没有才兜底状态码', async () => {
    mockCloudflare(400, { success: false, errors: [{ code: 1004 }], messages: [{ message: 'bad zone' }] })
    await expect((await call('get_zone', { zoneId: ZONE })).json())
      .resolves.toMatchObject({ code: 'invalid_argument', message: 'bad zone' })

    vi.unstubAllGlobals()
    mockCloudflare(400, { success: false, errors: [] })
    await expect((await call('get_zone', { zoneId: ZONE })).json())
      .resolves.toMatchObject({ code: 'invalid_argument', message: 'Cloudflare 返回 HTTP 400' })
  })

  it('上游 4xx → invalid_argument / not_found;5xx → unavailable + retryable', async () => {
    mockCloudflare(404, { success: false, errors: [{ message: 'Zone not found' }] })
    const missing = await call('get_zone', { zoneId: ZONE })
    expect(missing.status).toBe(404)
    await expect(missing.json()).resolves.toMatchObject({ code: 'not_found', message: 'Zone not found' })

    vi.unstubAllGlobals()
    mockCloudflare(403, { success: false, errors: [{ message: 'Insufficient permissions' }] })
    await expect((await call('get_zone', { zoneId: ZONE })).json())
      .resolves.toMatchObject({ code: 'permission_denied' })

    vi.unstubAllGlobals()
    mockCloudflare(500, { success: false, errors: [{ message: 'Cloudflare is down' }] })
    await expect((await call('get_zone', { zoneId: ZONE })).json())
      .resolves.toMatchObject({ code: 'unavailable', retryable: true })
  })

  it('2xx 上回非 JSON → unavailable(上游坏了,可重试),而不是被当成一次 200 的失败', async () => {
    mockRaw(200, '<html>maintenance</html>')
    const res = await call('get_zone', { zoneId: ZONE })
    expect(res.status).toBe(503)
    await expect(res.json()).resolves.toMatchObject({ code: 'unavailable', retryable: true })
  })

  it('响应形状不合契约(result 缺 id / 不是数组)→ unavailable,不是调用方的错', async () => {
    mockCloudflare(200, { success: true, result: { name: 'example.com' } })
    await expect((await call('get_zone', { zoneId: ZONE })).json())
      .resolves.toMatchObject({ code: 'unavailable', retryable: true })

    vi.unstubAllGlobals()
    mockCloudflare(200, { success: true, result: { not: 'an array' } })
    await expect((await call('list_zones', {})).json())
      .resolves.toMatchObject({ code: 'unavailable', retryable: true })
  })

  it('没配 authRef → unavailable 且不打上游', async () => {
    const mock = mockCloudflare(200, {})
    const res = await call('list_zones', {}, { auth: null })
    expect(res.status).toBe(503)
    expect(((await res.json()) as { message: string }).message).toContain('authRef')
    expect(mock).not.toHaveBeenCalled()
  })
})
