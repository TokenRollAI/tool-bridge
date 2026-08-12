import {
  base64urlEncode,
  type CallContext,
  encodeCallContext,
  encodeCredentialValues,
  HEADER_TB_CONTEXT,
  HEADER_TB_UPSTREAM_AUTH,
} from '@tool-bridge/core'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createUpstashRedisPlugin } from '../../src/upstash_redis/index'
import { upstashRedisActions } from '../../src/upstash_redis/schema'

/**
 * Upstash Redis 迁移产物的 wire 级验收。重点在四处迁移最容易迁丢的地方:
 * 凭证里那个决定出站目标的 restUrl(校验必须保留)、HTTP 200 的信封式错误、
 * 藏在错误消息里的配额信号、以及 key 去空白 / value 逐字保留的不对称。
 */

const PLUGIN_TOKEN = 'tbp_test'
const ENV = { PLUGIN_TOKEN }
const REST_URL = 'https://us1-test-12345.upstash.io'
const REST_TOKEN = 'AX_test_token'
const plugin = createUpstashRedisPlugin()

const CALLER: CallContext = {
  keyId: 'k1',
  owner: 'agent:tester',
  scopes: [],
  traceId: 't1',
  mountPath: 'data/upstash',
  exportId: 'actions',
}

interface CallOptions {
  /** 整份凭证都不给(测"没配 authRef")。 */
  auth?: null
  restToken?: string
  restUrl?: string
}

function envelope(body: unknown, opts: CallOptions = {}): Promise<Response> {
  const headers: Record<string, string> = {
    'authorization': `Bearer ${PLUGIN_TOKEN}`,
    'content-type': 'application/json',
    [HEADER_TB_CONTEXT]: encodeCallContext(CALLER),
  }
  if (opts.auth !== null) {
    const values = encodeCredentialValues({
      restUrl: opts.restUrl ?? REST_URL,
      restToken: opts.restToken ?? REST_TOKEN,
    })
    headers[HEADER_TB_UPSTREAM_AUTH] = base64urlEncode(new TextEncoder().encode(values))
  }
  return Promise.resolve(plugin.fetch(
    new Request('https://plugin.test/', { method: 'POST', headers, body: JSON.stringify(body) }),
    ENV as never,
  ))
}

function call(name: string, args: unknown, opts?: CallOptions): Promise<Response> {
  return envelope({ tool: 'Call', arguments: { name, args } }, opts)
}

/** Upstash 的成功信封是 `{result}`。 */
function mockUpstash(status: number, payload: unknown): ReturnType<typeof vi.fn> {
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

/** 上游收到的那条 Redis 命令(请求体就是命令数组)。 */
function sentCommand(mock: ReturnType<typeof vi.fn>): Promise<unknown> {
  return sent(mock).json()
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('契约面', () => {
  it('~describe 报单个 tools/v1 export,并宣告 restUrl/restToken 两个凭证字段', async () => {
    const res = await plugin.fetch(new Request('https://plugin.test/~describe'), ENV as never)
    const body = (await res.json()) as {
      exports: Array<{ credentialFields?: Array<{ key: string, required?: boolean, secret?: boolean }> }>
      protocolVersion: string
    }
    expect(body.protocolVersion).toBe('plugin/v2')
    expect(body.exports).toHaveLength(1)
    expect(body.exports[0]).toMatchObject({ id: 'actions', profile: 'tools/v1', description: 'Upstash Redis' })
    // 字段名必须与上游 definition.ts 的 auth[0].fields 逐字一致 —— 对不上就取不到值。
    expect(body.exports[0]?.credentialFields).toEqual([
      { key: 'restUrl', label: 'REST URL', required: true, secret: false, description: expect.any(String) },
      { key: 'restToken', label: 'REST Token', required: true, secret: true, description: expect.any(String) },
    ])
  })

  it('List 出全部 7 个 action,且都带 Zod 派生的 schema', async () => {
    const res = await envelope({ tool: 'List', arguments: {} })
    const tools = (await res.json()) as Array<{ inputSchema?: unknown, name: string, outputSchema?: unknown }>
    expect(tools).toHaveLength(Object.keys(upstashRedisActions).length)
    expect(tools).toHaveLength(7)
    expect(tools.map(tool => tool.name).sort()).toEqual([
      'delete',
      'exists',
      'expire',
      'get',
      'scan',
      'set',
      'ttl',
    ])
    for (const tool of tools) {
      expect(tool.inputSchema, `${tool.name} 缺 inputSchema`).toBeDefined()
      expect(tool.outputSchema, `${tool.name} 缺 outputSchema`).toBeDefined()
    }
  })
})

describe('请求拼装', () => {
  it('get:POST 到凭证里的 restUrl 根路径,body 就是 Redis 命令数组,令牌走 Bearer', async () => {
    const mock = mockUpstash(200, { result: 'hello' })
    const res = await call('get', { key: 'greeting' })

    const request = sent(mock)
    expect(request.method).toBe('POST')
    expect(request.url).toBe(`${REST_URL}/`)
    expect(request.headers.get('authorization')).toBe(`Bearer ${REST_TOKEN}`)
    expect(request.headers.get('content-type')).toBe('application/json')
    expect(request.headers.get('accept')).toBe('application/json')
    await expect(request.json()).resolves.toEqual(['GET', 'greeting'])
    await expect(res.json()).resolves.toEqual({ content: { value: 'hello' } })
  })

  it('set:EX 与 NX/XX 按 Redis 的位置参数顺序追加,未给则整段不出现', async () => {
    const full = mockUpstash(200, { result: 'OK' })
    await call('set', { key: 'k', value: 'v', expirationSeconds: 60, condition: 'NX' })
    await expect(sentCommand(full)).resolves.toEqual(['SET', 'k', 'v', 'EX', 60, 'NX'])

    vi.unstubAllGlobals()
    const bare = mockUpstash(200, { result: 'OK' })
    await call('set', { key: 'k', value: 'v' })
    await expect(sentCommand(bare)).resolves.toEqual(['SET', 'k', 'v'])
  })

  it('scan:cursor 缺省是 "0",MATCH/COUNT 只在给了才追加', async () => {
    const bare = mockUpstash(200, { result: ['12', ['a', 'b']] })
    await call('scan', {})
    await expect(sentCommand(bare)).resolves.toEqual(['SCAN', '0'])

    vi.unstubAllGlobals()
    const full = mockUpstash(200, { result: ['0', []] })
    await call('scan', { cursor: '12', match: 'user:*', count: 100 })
    await expect(sentCommand(full)).resolves.toEqual(['SCAN', '12', 'MATCH', 'user:*', 'COUNT', 100])
  })

  it('delete / exists / expire / ttl 各自发对应的命令', async () => {
    const del = mockUpstash(200, { result: 1 })
    await call('delete', { key: 'k' })
    await expect(sentCommand(del)).resolves.toEqual(['DEL', 'k'])

    vi.unstubAllGlobals()
    const has = mockUpstash(200, { result: 0 })
    await call('exists', { key: 'k' })
    await expect(sentCommand(has)).resolves.toEqual(['EXISTS', 'k'])

    vi.unstubAllGlobals()
    const exp = mockUpstash(200, { result: 1 })
    await call('expire', { key: 'k', expirationSeconds: 30 })
    await expect(sentCommand(exp)).resolves.toEqual(['EXPIRE', 'k', 30])

    vi.unstubAllGlobals()
    const rest = mockUpstash(200, { result: -1 })
    await call('ttl', { key: 'k' })
    await expect(sentCommand(rest)).resolves.toEqual(['TTL', 'k'])
  })

  it('key 去空白,value 逐字保留(Redis 字符串不透明:SET 什么 GET 就该读回什么)', async () => {
    const mock = mockUpstash(200, { result: 'OK' })
    await call('set', { key: '  k  ', value: '  spaced  ' })
    await expect(sentCommand(mock)).resolves.toEqual(['SET', 'k', '  spaced  '])
  })
})

describe('响应整形', () => {
  it('get:键不存在时 result 是 null,原样透出而不是当错误', async () => {
    mockUpstash(200, { result: null })
    await expect((await call('get', { key: 'missing' })).json())
      .resolves.toEqual({ content: { value: null } })
  })

  it('set:条件不满足时 Redis 回 null,那是业务结果 → stored:false', async () => {
    mockUpstash(200, { result: null })
    await expect((await call('set', { key: 'k', value: 'v', condition: 'NX' })).json())
      .resolves.toEqual({ content: { stored: false } })

    vi.unstubAllGlobals()
    mockUpstash(200, { result: 'OK' })
    await expect((await call('set', { key: 'k', value: 'v' })).json())
      .resolves.toEqual({ content: { stored: true } })
  })

  it('0/1 计数结果折成布尔;ttl 的 -1/-2 是有意义的整数,原样透出', async () => {
    mockUpstash(200, { result: 1 })
    await expect((await call('delete', { key: 'k' })).json())
      .resolves.toEqual({ content: { deleted: true } })

    vi.unstubAllGlobals()
    mockUpstash(200, { result: -2 })
    await expect((await call('ttl', { key: 'k' })).json())
      .resolves.toEqual({ content: { ttlSeconds: -2 } })
  })

  it('scan:cursor 回成数字也归一成字符串,complete 由 "0" 判定', async () => {
    mockUpstash(200, { result: [17, ['a', 'b']] })
    await expect((await call('scan', {})).json())
      .resolves.toEqual({ content: { nextCursor: '17', keys: ['a', 'b'], complete: false } })

    vi.unstubAllGlobals()
    mockUpstash(200, { result: ['0', ['z']] })
    await expect((await call('scan', {})).json())
      .resolves.toEqual({ content: { nextCursor: '0', keys: ['z'], complete: true } })
  })
})

describe('校验与错误', () => {
  it('入参校验真的生效:count 越界 → invalid_argument 且不打上游', async () => {
    const mock = mockUpstash(200, { result: [] })
    const res = await call('scan', { count: 5000 })
    expect(res.status).toBe(400)
    expect(((await res.json()) as { code: string }).code).toBe('invalid_argument')
    expect(mock).not.toHaveBeenCalled()
  })

  it('纯空白的 key 能过 Zod 的 min(1),但在本地就挡下', async () => {
    const mock = mockUpstash(200, { result: null })
    const res = await call('get', { key: '   ' })
    expect(res.status).toBe(400)
    expect(((await res.json()) as { message: string }).message).toContain('key')
    expect(mock).not.toHaveBeenCalled()
  })

  it('HTTP 200 + {error} 是命令级失败,不能当成功返回', async () => {
    const mock = mockUpstash(200, { error: 'ERR wrong number of arguments for \'get\' command' })
    const res = await call('get', { key: 'k' })
    expect(res.status).toBe(400)
    await expect(res.json()).resolves.toMatchObject({
      code: 'invalid_argument',
      message: 'ERR wrong number of arguments for \'get\' command',
    })
    expect(mock).toHaveBeenCalledOnce()
  })

  it('配额/连接数超限藏在错误消息里(Upstash 不用 429),按文本判成 rate_limited', async () => {
    mockUpstash(400, { error: 'ERR max daily request limit exceeded' })
    const daily = await call('get', { key: 'k' })
    expect(daily.status).toBe(429)
    await expect(daily.json()).resolves.toMatchObject({ code: 'rate_limited', retryable: true })

    vi.unstubAllGlobals()
    mockUpstash(200, { error: 'ERR max concurrent connections exceeded' })
    const concurrent = await call('get', { key: 'k' })
    expect(concurrent.status).toBe(429)
    await expect(concurrent.json()).resolves.toMatchObject({ code: 'rate_limited', retryable: true })
  })

  it('上游 4xx → invalid_argument / 401 保留,5xx → unavailable + retryable', async () => {
    mockUpstash(401, { error: 'Unauthorized' })
    const unauthorized = await call('get', { key: 'k' })
    expect(unauthorized.status).toBe(401)
    await expect(unauthorized.json()).resolves.toMatchObject({ code: 'permission_denied' })

    vi.unstubAllGlobals()
    mockUpstash(400, { error: 'ERR syntax error' })
    expect((await call('get', { key: 'k' })).status).toBe(400)

    vi.unstubAllGlobals()
    mockUpstash(503, { message: 'upstream unavailable' })
    await expect((await call('get', { key: 'k' })).json())
      .resolves.toMatchObject({ code: 'unavailable', retryable: true, message: 'upstream unavailable' })
  })

  it('响应形状不合契约 → unavailable + retryable(是上游的问题,不是调用方的)', async () => {
    mockUpstash(200, { nothing: true })
    await expect((await call('get', { key: 'k' })).json())
      .resolves.toMatchObject({ code: 'unavailable', retryable: true })

    vi.unstubAllGlobals()
    mockUpstash(200, { result: 42 })
    await expect((await call('get', { key: 'k' })).json())
      .resolves.toMatchObject({ code: 'unavailable', retryable: true })

    vi.unstubAllGlobals()
    mockUpstash(200, { result: ['0'] })
    await expect((await call('scan', {})).json())
      .resolves.toMatchObject({ code: 'unavailable', retryable: true })
  })

  it('没配 authRef → unavailable 且不打上游', async () => {
    const mock = mockUpstash(200, { result: null })
    const res = await call('get', { key: 'k' }, { auth: null })
    expect(res.status).toBe(503)
    expect(((await res.json()) as { message: string }).message).toContain('authRef')
    expect(mock).not.toHaveBeenCalled()
  })
})

describe('restUrl 是凭证里的出站目标,校验必须保留', () => {
  it.each([
    ['http 明文', 'http://us1-test.upstash.io'],
    ['带端口', 'https://us1-test.upstash.io:8443'],
    ['带路径', 'https://us1-test.upstash.io/pipeline'],
    ['带查询串', 'https://us1-test.upstash.io/?x=1'],
    ['带用户名密码', 'https://user:pw@us1-test.upstash.io'],
    ['非官方主机', 'https://evil.example.com'],
    ['主机名只是后缀相似', 'https://notupstash.io'],
    ['压根不是 URL', 'us1-test.upstash.io'],
  ])('%s 的 restUrl 被拒 → invalid_argument 且不打上游', async (_label, restUrl) => {
    const mock = mockUpstash(200, { result: null })
    const res = await call('get', { key: 'k' }, { restUrl })
    expect(res.status).toBe(400)
    await expect(res.json()).resolves.toMatchObject({ code: 'invalid_argument' })
    expect(mock).not.toHaveBeenCalled()
  })

  it('合规的 restUrl 放行,restToken 不会漏进 URL', async () => {
    const mock = mockUpstash(200, { result: null })
    await call('get', { key: 'k' }, { restUrl: 'https://eu2-fine-99.upstash.io/' })
    expect(sent(mock).url).toBe('https://eu2-fine-99.upstash.io/')
    expect(sent(mock).url).not.toContain(REST_TOKEN)
  })
})
