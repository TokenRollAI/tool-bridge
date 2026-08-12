import {
  base64urlEncode,
  type CallContext,
  encodeCallContext,
  HEADER_TB_CONTEXT,
  HEADER_TB_UPSTREAM_AUTH,
} from '@tool-bridge/core'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createFlyPlugin } from '../../src/fly/index'
import { flyActions } from '../../src/fly/schema'

/**
 * Fly.io 迁移产物的 wire 级验收。重点在几个"迁移最容易迁丢"的地方:
 * stop 与 restart 的 signal/timeout 一个在 body 一个在 query、生命周期动作的空体应答、
 * 布尔开关"只在 true 时才发"、schema 没标 required 但 runtime 有断言的路径参数,
 * 以及 Fly 那套不带 content-type 的响应体解析。
 */

const PLUGIN_TOKEN = 'tbp_test'
const ENV = { PLUGIN_TOKEN }
const API_KEY = 'fo1_flytoken'
const plugin = createFlyPlugin()

const CALLER: CallContext = {
  keyId: 'k1',
  owner: 'agent:tester',
  scopes: [],
  traceId: 't1',
  mountPath: 'infra/fly',
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

/** 原始文本 + 可控 headers:Fly 的响应常常不带 content-type。 */
function mockRaw(status: number, body: string, headers: Record<string, string> = {}): ReturnType<typeof vi.fn> {
  const fn = vi.fn(() => Promise.resolve(new Response(body === '' ? null : body, { status, headers })))
  vi.stubGlobal('fetch', fn)
  return fn
}

function mockFly(status: number, payload: unknown): ReturnType<typeof vi.fn> {
  return mockRaw(status, JSON.stringify(payload), { 'content-type': 'application/json' })
}

/** 取上游收到的那个请求。 */
function sent(mock: ReturnType<typeof vi.fn>): Request {
  return (mock.mock.calls[0] as [Request])[0]
}

const MACHINE = { app_name: 'my-app', machine_id: '148e21ebc93789' }

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('契约面', () => {
  it('~describe 报成单个 tools/v1 export,且不声明凭证探针', async () => {
    const res = await createFlyPlugin().fetch(new Request('https://plugin.test/~describe'), {} as never)
    await expect(res.json()).resolves.toEqual({
      protocolVersion: 'plugin/v2',
      exports: [{ id: 'actions', profile: 'tools/v1', description: 'Fly.io' }],
    })
  })

  it('List 出全部 9 个 action,且都带 Zod 派生的 schema', async () => {
    const res = await envelope({ tool: 'List', arguments: {} })
    const tools = (await res.json()) as Array<{ inputSchema?: unknown, name: string, outputSchema?: unknown }>
    expect(tools).toHaveLength(Object.keys(flyActions).length)
    expect(tools).toHaveLength(9)
    expect(tools.map(tool => tool.name).sort()).toEqual([
      'create_machine',
      'get_app',
      'get_machine',
      'list_apps',
      'list_machines',
      'restart_machine',
      'start_machine',
      'stop_machine',
      'wait_for_machine',
    ])
    for (const tool of tools) {
      expect(tool.inputSchema, `${tool.name} 缺 inputSchema`).toBeDefined()
      expect(tool.outputSchema, `${tool.name} 缺 outputSchema`).toBeDefined()
    }
  })
})

describe('请求拼装', () => {
  it('list_apps:base URL 的 /v1 前缀保住,凭证走 Bearer 头,GET 无请求体', async () => {
    const mock = mockFly(200, { apps: [], total_apps: 0 })
    await call('list_apps', { org_slug: 'personal', app_role: 'app' })

    const request = sent(mock)
    const url = new URL(request.url)
    expect(request.method).toBe('GET')
    expect(url.origin).toBe('https://api.machines.dev')
    expect(url.pathname).toBe('/v1/apps')
    expect(request.headers.get('authorization')).toBe(`Bearer ${API_KEY}`)
    // GET 不带体,就不该声明 content-type。
    expect(request.headers.get('content-type')).toBeNull()
    expect(await request.text()).toBe('')
    expect(Object.fromEntries(url.searchParams)).toEqual({ org_slug: 'personal', app_role: 'app' })
  })

  it('list_machines:布尔开关只在 true 时才发,空白过滤器等同未给', async () => {
    const mock = mockFly(200, [])
    await call('list_machines', {
      app_name: 'my-app',
      include_deleted: false,
      summary: true,
      region: '   ',
      state: 'started',
    })

    const url = new URL(sent(mock).url)
    expect(url.pathname).toBe('/v1/apps/my-app/machines')
    // include_deleted=false 不发 —— Fly 认"出现即为真",带上反而会开启它。
    expect(Object.fromEntries(url.searchParams)).toEqual({ summary: 'true', state: 'started' })
  })

  it('create_machine:app_name 只进路径不进体,name/region 去空白', async () => {
    const mock = mockFly(200, { id: 'm1', state: 'created' })
    await call('create_machine', {
      app_name: 'my-app',
      config: { image: 'flyio/fastify-functions' },
      region: '  ord  ',
      name: '   ',
      skip_launch: true,
      lease_ttl: 30,
    })

    const request = sent(mock)
    expect(request.method).toBe('POST')
    expect(new URL(request.url).pathname).toBe('/v1/apps/my-app/machines')
    expect(request.headers.get('content-type')).toBe('application/json')
    await expect(request.json()).resolves.toEqual({
      config: { image: 'flyio/fastify-functions' },
      region: 'ord',
      skip_launch: true,
      lease_ttl: 30,
    })
  })

  it('路径段做 URL 编码,不会让斜杠改写路径结构', async () => {
    const mock = mockFly(200, { id: 'm1' })
    await call('get_machine', { app_name: 'my/app', machine_id: 'id 1' })
    expect(new URL(sent(mock).url).pathname).toBe('/v1/apps/my%2Fapp/machines/id%201')
  })

  it('stop 的 signal/timeout 在 body,restart 的同名两参在 query —— 两者不能对调', async () => {
    const stop = mockRaw(200, '')
    const stopped = await call('stop_machine', { ...MACHINE, signal: 'SIGTERM', timeout: '5s' })
    const stopRequest = sent(stop)
    expect(new URL(stopRequest.url).pathname).toBe('/v1/apps/my-app/machines/148e21ebc93789/stop')
    expect([...new URL(stopRequest.url).searchParams.keys()]).toEqual([])
    await expect(stopRequest.json()).resolves.toEqual({ signal: 'SIGTERM', timeout: '5s' })
    await expect(stopped.json()).resolves.toEqual({ content: { ok: true } })

    vi.unstubAllGlobals()
    const restart = mockRaw(200, '')
    const restarted = await call('restart_machine', { ...MACHINE, signal: 'SIGTERM', timeout: '5s' })
    const restartRequest = sent(restart)
    expect(new URL(restartRequest.url).pathname).toBe('/v1/apps/my-app/machines/148e21ebc93789/restart')
    expect(Object.fromEntries(new URL(restartRequest.url).searchParams))
      .toEqual({ signal: 'SIGTERM', timeout: '5s' })
    expect(await restartRequest.text()).toBe('')
    await expect(restarted.json()).resolves.toEqual({ content: { ok: true } })
  })

  it('stop 不给 signal/timeout 时不发请求体(空对象体与无体在 Fly 侧不等价)', async () => {
    const mock = mockRaw(200, '')
    await call('stop_machine', MACHINE)
    const request = sent(mock)
    expect(await request.text()).toBe('')
    expect(request.headers.get('content-type')).toBeNull()
  })

  it('start_machine 的空体 200 归成 {ok:true},不因"没有 JSON"报错', async () => {
    const mock = mockRaw(200, '')
    const res = await call('start_machine', MACHINE)
    expect(new URL(sent(mock).url).pathname).toBe('/v1/apps/my-app/machines/148e21ebc93789/start')
    await expect(res.json()).resolves.toEqual({ content: { ok: true } })
  })

  it('wait_for_machine:数字 timeout 进 query,响应原样透出', async () => {
    const mock = mockFly(200, { ok: true, state: 'started' })
    const res = await call('wait_for_machine', { ...MACHINE, state: 'started', timeout: 30 })
    const url = new URL(sent(mock).url)
    expect(url.pathname).toBe('/v1/apps/my-app/machines/148e21ebc93789/wait')
    expect(Object.fromEntries(url.searchParams)).toEqual({ state: 'started', timeout: '30' })
    await expect(res.json()).resolves.toEqual({ content: { ok: true, state: 'started' } })
  })
})

describe('响应解析', () => {
  it('Fly 不带 content-type 时按首字符判 JSON —— 否则整份结果会退化成一个字符串', async () => {
    mockRaw(200, '{"id":"m1","state":"started"}')
    const res = await call('get_machine', MACHINE)
    await expect(res.json()).resolves.toEqual({ content: { id: 'm1', state: 'started' } })
  })

  it('期待 JSON 却回空体 → unavailable + retryable(上游出问题,不是调用方的错)', async () => {
    mockRaw(200, '')
    const res = await call('get_machine', MACHINE)
    await expect(res.json()).resolves.toMatchObject({
      code: 'unavailable',
      retryable: true,
      message: 'Fly.io returned an empty response',
    })
  })
})

describe('校验与错误', () => {
  it('入参校验真的生效:list_machines 不认未知字段 → 400 且不打上游', async () => {
    const mock = mockFly(200, [])
    const res = await call('list_machines', { app_name: 'my-app', nope: true })
    expect(res.status).toBe(400)
    expect(((await res.json()) as { code: string }).code).toBe('invalid_argument')
    expect(mock).not.toHaveBeenCalled()
  })

  it('app_name / machine_id 在 schema 里是 optional(忠实反映上游),必填断言留在 api 层', async () => {
    // Zod 放行 {},上游 runtime 的 requiredActionString 才是真正的闸门 —— 这处最容易迁丢。
    expect(() => flyActions.get_machine.inputSchema.parse({})).not.toThrow()

    const mock = mockFly(200, {})
    const res = await call('get_machine', {})
    expect(res.status).toBe(400)
    await expect(res.json()).resolves.toMatchObject({
      code: 'invalid_argument',
      message: expect.stringContaining('app_name'),
    })

    const noMachine = await call('get_machine', { app_name: 'my-app' })
    expect(noMachine.status).toBe(400)
    await expect(noMachine.json()).resolves.toMatchObject({
      message: expect.stringContaining('machine_id'),
    })
    expect(mock).not.toHaveBeenCalled()
  })

  it('上游错误按状态归一,消息在 error / message / details 里找', async () => {
    mockFly(404, { error: 'machine not found' })
    const missing = await call('get_machine', MACHINE)
    expect(missing.status).toBe(404)
    await expect(missing.json()).resolves.toMatchObject({
      code: 'not_found',
      message: 'machine not found',
    })

    vi.unstubAllGlobals()
    mockFly(401, { message: 'invalid token' })
    const unauthorized = await call('list_apps', { org_slug: 'personal' })
    expect(unauthorized.status).toBe(401)
    await expect(unauthorized.json()).resolves.toMatchObject({
      code: 'permission_denied',
      message: 'invalid token',
    })

    vi.unstubAllGlobals()
    mockFly(422, { details: 'image is required' })
    await expect((await call('create_machine', { app_name: 'a', config: {} })).json())
      .resolves.toMatchObject({ code: 'invalid_argument', message: 'image is required' })

    vi.unstubAllGlobals()
    mockFly(503, {})
    await expect((await call('list_apps', { org_slug: 'personal' })).json())
      .resolves.toMatchObject({
        code: 'unavailable',
        retryable: true,
        message: 'Fly.io request failed with status 503',
      })
  })

  it('纯文本错误体也能拿到消息(Fly 的网关层不回 JSON)', async () => {
    mockRaw(500, '  upstream boom  ', { 'content-type': 'text/plain' })
    await expect((await call('list_apps', { org_slug: 'personal' })).json())
      .resolves.toMatchObject({ code: 'unavailable', message: 'upstream boom' })
  })

  it('没配 authRef → unavailable 且不打上游', async () => {
    const mock = mockFly(200, {})
    const res = await call('list_apps', { org_slug: 'personal' }, { auth: null })
    expect(res.status).toBe(503)
    expect(((await res.json()) as { message: string }).message).toContain('authRef')
    expect(mock).not.toHaveBeenCalled()
  })
})
