import {
  base64urlEncode,
  type CallContext,
  encodeCallContext,
  HEADER_TB_CONTEXT,
  HEADER_TB_UPSTREAM_AUTH,
} from '@tool-bridge/core'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createRunpodPlugin } from '../../src/runpod/index'
import { runpodActions } from '../../src/runpod/schema'

/**
 * Runpod 迁移产物的 wire 级验收。重点在几个"迁移最容易迁丢"的地方:
 * 裸数组响应、生命周期接口的空体成功、Pod 白名单整形、数组 query 重复同名键。
 */

const PLUGIN_TOKEN = 'tbp_test'
const ENV = { PLUGIN_TOKEN }
const API_KEY = 'rpa_deadbeef'
const plugin = createRunpodPlugin()

const CALLER: CallContext = {
  keyId: 'k1',
  owner: 'agent:tester',
  scopes: [],
  traceId: 't1',
  mountPath: 'infra/runpod',
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

function mockRunpod(status: number, payload: unknown): ReturnType<typeof vi.fn> {
  const fn = vi.fn(() => Promise.resolve(new Response(JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json' },
  })))
  vi.stubGlobal('fetch', fn)
  return fn
}

/** 生命周期接口成功时回空体,不能用 mockRunpod(它总会写一段 JSON)。 */
function mockEmpty(status: number): ReturnType<typeof vi.fn> {
  const fn = vi.fn(() => Promise.resolve(new Response(null, { status })))
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
  it('List 出全部 7 个 action,且都带 Zod 派生的 schema', async () => {
    const res = await envelope({ tool: 'List', arguments: {} })
    const tools = (await res.json()) as Array<{ inputSchema?: unknown, name: string, outputSchema?: unknown }>
    expect(tools).toHaveLength(Object.keys(runpodActions).length)
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
    expect(effectOf('list_pods')).toBe('read')
    expect(effectOf('get_pod')).toBe('read')
    expect(effectOf('stop_pod')).toBe('write')
    expect(effectOf('delete_pod')).toBe('destructive')
  })
})

describe('请求成形与响应整形', () => {
  it('list_pods:数组过滤器重复同名键,响应裸数组包成 {pods} 并按白名单整形', async () => {
    const mock = mockRunpod(200, [
      {
        id: 'pod_1',
        name: 'trainer',
        costPerHr: 0.34,
        ports: ['8888/http', 22],
        env: { KEY: 'v', BAD: 3 },
        portMappings: { 22: 10022, x: 'nope' },
        // 契约里没有的字段不该透出。
        internalDebugField: 'leak',
      },
    ])
    const res = await call('list_pods', {
      computeType: 'GPU',
      gpuTypeId: ['NVIDIA RTX A5000', 'NVIDIA A100'],
      includeMachine: true,
    })

    const request = sent(mock)
    const url = new URL(request.url)
    expect(url.origin + url.pathname).toBe('https://rest.runpod.io/v1/pods')
    expect(request.headers.get('authorization')).toBe(`Bearer ${API_KEY}`)
    expect(url.searchParams.getAll('gpuTypeId')).toEqual(['NVIDIA RTX A5000', 'NVIDIA A100'])
    expect(url.searchParams.get('computeType')).toBe('GPU')
    expect(url.searchParams.get('includeMachine')).toBe('true')

    await expect(res.json()).resolves.toEqual({
      content: {
        pods: [{
          id: 'pod_1',
          name: 'trainer',
          costPerHr: 0.34,
          // 非字符串条目被剔除,不是整个字段丢弃。
          ports: ['8888/http'],
          env: { KEY: 'v' },
          portMappings: { 22: 10022 },
        }],
      },
    })
  })

  it('get_pod:路径参数被 URL 编码,include 开关进 query', async () => {
    const mock = mockRunpod(200, { id: 'pod/1' })
    await call('get_pod', { podId: 'pod/1', includeTemplate: true })
    const url = new URL(sent(mock).url)
    expect(url.pathname).toBe('/v1/pods/pod%2F1')
    expect(url.searchParams.get('includeTemplate')).toBe('true')
  })

  it('生命周期接口:空体也算成功,结果由本地合成', async () => {
    const stop = mockEmpty(204)
    const res = await call('stop_pod', { podId: 'pod_1' })
    expect(sent(stop).url).toBe('https://rest.runpod.io/v1/pods/pod_1/stop')
    expect(sent(stop).method).toBe('POST')
    await expect(res.json()).resolves.toEqual({
      content: { podId: 'pod_1', action: 'stop', success: true },
    })

    vi.unstubAllGlobals()
    const remove = mockEmpty(200)
    const deleted = await call('delete_pod', { podId: 'pod_1' })
    // delete 没有路径后缀,方法才是区别。
    expect(sent(remove).url).toBe('https://rest.runpod.io/v1/pods/pod_1')
    expect(sent(remove).method).toBe('DELETE')
    await expect(deleted.json()).resolves.toEqual({
      content: { podId: 'pod_1', action: 'delete', success: true },
    })
  })
})

describe('校验与错误', () => {
  it('入参校验真的生效:podId 空串 → 400 且不打上游', async () => {
    const mock = mockRunpod(200, {})
    const res = await call('get_pod', { podId: '' })
    expect(res.status).toBe(400)
    expect(((await res.json()) as { code: string }).code).toBe('invalid_argument')
    expect(mock).not.toHaveBeenCalled()
  })

  it('生命周期 action 的 podId 在 schema 里是 optional,由运行时补上必填校验', async () => {
    const mock = mockRunpod(200, {})
    const res = await call('start_pod', {})
    expect(res.status).toBe(400)
    expect(((await res.json()) as { message: string }).message).toContain('podId is required')
    expect(mock).not.toHaveBeenCalled()
  })

  it('上游错误按状态归一,消息取自 message / 嵌套 error', async () => {
    mockRunpod(401, { error: 'Invalid API key' })
    const unauthorized = await call('list_pods', {})
    expect(unauthorized.status).toBe(401)
    await expect(unauthorized.json()).resolves.toMatchObject({
      code: 'permission_denied',
      message: 'Invalid API key',
    })

    vi.unstubAllGlobals()
    mockRunpod(429, { error: { message: 'Rate limit exceeded' } })
    await expect((await call('list_pods', {})).json())
      .resolves.toMatchObject({ code: 'rate_limited', retryable: true, message: 'Rate limit exceeded' })

    vi.unstubAllGlobals()
    // 上游把 404 压成 400;迁移后交回 upstreamError,找不到 Pod 仍是 not_found。
    mockRunpod(404, { message: 'pod not found' })
    await expect((await call('get_pod', { podId: 'nope' })).json())
      .resolves.toMatchObject({ code: 'not_found' })

    vi.unstubAllGlobals()
    mockRunpod(500, {})
    await expect((await call('list_pods', {})).json())
      .resolves.toMatchObject({ code: 'unavailable', retryable: true })
  })

  it('/pods 回非数组时按上游破契约处理', async () => {
    mockRunpod(200, { pods: [] })
    await expect((await call('list_pods', {})).json())
      .resolves.toMatchObject({ code: 'unavailable', message: expect.stringContaining('non-array') as unknown })
  })

  it('没配 authRef → unavailable 且不打上游', async () => {
    const mock = mockRunpod(200, [])
    const res = await call('list_pods', {}, { auth: null })
    expect(res.status).toBe(503)
    expect(((await res.json()) as { message: string }).message).toContain('authRef')
    expect(mock).not.toHaveBeenCalled()
  })
})
