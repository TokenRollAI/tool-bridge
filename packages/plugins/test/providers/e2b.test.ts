import { describe, expect, it, vi } from 'vitest'
import { z } from 'zod/v4'
import { createProviderHarness } from '../support/providerHarness'
import { createE2bPlugin } from '../../src/e2b/index'
import { e2bActions } from '../../src/e2b/schema'

/**
 * E2B 迁移产物的 wire 级验收。重点钉住几处"迁移最容易迁丢"的地方:
 * list 走 /v2 而其余走 /v1 的路径分裂、裸数组响应的包装、`state` 的逗号拼接、
 * DELETE 204 空 body 合成出参、以及 schema 可选但 executor 必填的 sandboxID。
 */

const API_KEY = 'e2b_deadbeef'
const plugin = createE2bPlugin()

const {
  call,
  envelope,
  sent,
  env: ENV,
  stubFetch,
} = createProviderHarness({
  mountPath: 'dev/e2b',
  plugin,
  upstreamAuth: API_KEY,
})

function mockE2b(status: number, payload: unknown): ReturnType<typeof vi.fn> {
  const body = status === 204 || payload === undefined
    ? null
    : (typeof payload === 'string' ? payload : JSON.stringify(payload))
  return stubFetch(() => Promise.resolve(new Response(body, {
    status,
    headers: { 'content-type': 'application/json' },
  })))
}

describe('契约面', () => {
  it('List 出全部 4 个 action,且都带 Zod 派生的 schema', async () => {
    const res = await envelope({ tool: 'List', arguments: {} })
    const tools = (await res.json()) as Array<{ inputSchema?: unknown, name: string, outputSchema?: unknown }>
    expect(tools).toHaveLength(Object.keys(e2bActions).length)
    expect(tools).toHaveLength(4)
    expect(tools.map(tool => tool.name).sort()).toEqual([
      'create_sandbox',
      'delete_sandbox',
      'get_sandbox',
      'list_sandboxes',
    ])
    for (const tool of tools) {
      expect(tool.inputSchema, `${tool.name} 缺 inputSchema`).toBeDefined()
      expect(tool.outputSchema, `${tool.name} 缺 outputSchema`).toBeDefined()
    }
  })

  it('~describe 报成单个 tools/v1 export,并带上探针工具名', async () => {
    const res = await plugin.fetch(new Request('https://plugin.test/~describe'), ENV as never)
    await expect(res.json()).resolves.toEqual({
      protocolVersion: 'plugin/v2',
      exports: [{
        auth: { kind: 'single', required: true },
        id: 'actions',
        profile: 'tools/v1',
        description: 'E2B',
        credentialProbe: 'list_sandboxes',
      }],
    })
  })

  it('探针指向的工具确实存在、只读、且无必填入参(平台挂载时会空参调它)', () => {
    const spec = e2bActions.list_sandboxes
    expect(spec.effect).toBe('read')
    const schema = z.toJSONSchema(spec.inputSchema, { io: 'input' }) as { required?: string[] }
    expect(schema.required ?? []).toEqual([])
  })
})

describe('请求拼装', () => {
  it('create_sandbox 打 /sandboxes(不是 /v2),凭证走 x-api-key 头', async () => {
    const mock = mockE2b(201, { sandboxID: 'sb-1', templateID: 'base' })
    const res = await call('create_sandbox', { templateID: 'base', timeout: 300, secure: true })

    const request = sent(mock)
    expect(request.method).toBe('POST')
    expect(request.url).toBe('https://api.e2b.app/sandboxes')
    expect(request.headers.get('x-api-key')).toBe(API_KEY)
    expect(request.headers.get('accept')).toBe('application/json')
    expect(request.headers.get('content-type')).toBe('application/json')
    await expect(request.json()).resolves.toEqual({ templateID: 'base', timeout: 300, secure: true })
    // 上游回裸对象,出参 schema 要 {sandbox}。
    await expect(res.json()).resolves.toEqual({
      content: { sandbox: { sandboxID: 'sb-1', templateID: 'base' } },
    })
  })

  it('list_sandboxes 打 /v2/sandboxes —— 只有列表走 v2,统一前缀会 404', async () => {
    const mock = mockE2b(200, [])
    await call('list_sandboxes', {})
    expect(new URL(sent(mock).url).pathname).toBe('/v2/sandboxes')
    expect(sent(mock).method).toBe('GET')
  })

  it('state 数组拼成一个逗号串,不是重复的同名参数(E2B 只认前者)', async () => {
    const mock = mockE2b(200, [])
    await call('list_sandboxes', { state: ['running', 'paused'], limit: 10, nextToken: 'tok' })
    const url = new URL(sent(mock).url)
    expect(url.searchParams.getAll('state')).toEqual(['running,paused'])
    expect(Object.fromEntries(url.searchParams)).toEqual({
      state: 'running,paused',
      limit: '10',
      nextToken: 'tok',
    })
  })

  it('未给的可选参数不出现在 query 里', async () => {
    const mock = mockE2b(200, [])
    await call('list_sandboxes', {})
    expect([...new URL(sent(mock).url).searchParams.keys()]).toEqual([])
  })

  it('get_sandbox 的 sandboxID 进路径且做 URL 编码,GET 不带 content-type', async () => {
    const mock = mockE2b(200, { sandboxID: 'sb/1' })
    const res = await call('get_sandbox', { sandboxID: 'sb/1' })
    const request = sent(mock)
    expect(request.url).toBe('https://api.e2b.app/sandboxes/sb%2F1')
    expect(request.headers.get('content-type')).toBeNull()
    await expect(res.json()).resolves.toEqual({ content: { sandbox: { sandboxID: 'sb/1' } } })
  })

  it('mcp: null 会原样发给上游("显式关掉"与"没给"不是一回事)', async () => {
    const mock = mockE2b(201, { sandboxID: 'sb-1' })
    await call('create_sandbox', { templateID: 'base', mcp: null })
    await expect(sent(mock).json()).resolves.toEqual({ templateID: 'base', mcp: null })

    vi.unstubAllGlobals()
    const omitted = mockE2b(201, { sandboxID: 'sb-1' })
    await call('create_sandbox', { templateID: 'base' })
    await expect(sent(omitted).json()).resolves.toEqual({ templateID: 'base' })
  })
})

describe('响应整形', () => {
  it('list_sandboxes 把裸数组包成 {sandboxes}', async () => {
    mockE2b(200, [{ sandboxID: 'sb-1', state: 'running' }, { sandboxID: 'sb-2', state: 'paused' }])
    const res = await call('list_sandboxes', {})
    await expect(res.json()).resolves.toEqual({
      content: {
        sandboxes: [{ sandboxID: 'sb-1', state: 'running' }, { sandboxID: 'sb-2', state: 'paused' }],
      },
    })
  })

  it('列表回的不是数组 → unavailable + retryable(契约破了,不是调用方的错)', async () => {
    mockE2b(200, { sandboxes: [] })
    const res = await call('list_sandboxes', {})
    await expect(res.json()).resolves.toMatchObject({
      code: 'unavailable',
      retryable: true,
      message: 'E2B returned a non-array sandboxes payload',
    })
  })

  it('delete_sandbox 的 204 空 body 合成成 {sandboxID, success}', async () => {
    const mock = mockE2b(204, undefined)
    const res = await call('delete_sandbox', { sandboxID: 'sb-1' })
    expect(sent(mock).method).toBe('DELETE')
    expect(sent(mock).url).toBe('https://api.e2b.app/sandboxes/sb-1')
    await expect(res.json()).resolves.toEqual({ content: { sandboxID: 'sb-1', success: true } })
  })
})

describe('校验与错误', () => {
  it('sandboxID 在 schema 里是可选的,但 executor 必填 → invalid_argument 且不打上游', async () => {
    const mock = mockE2b(200, {})
    const res = await call('get_sandbox', {})
    expect(res.status).toBe(400)
    await expect(res.json()).resolves.toMatchObject({
      code: 'invalid_argument',
      message: 'sandboxID is required.',
    })
    expect(mock).not.toHaveBeenCalled()
  })

  it('入参校验真的生效:limit 越界 → 400 且不打上游', async () => {
    const mock = mockE2b(200, [])
    const res = await call('list_sandboxes', { limit: 500 })
    expect(res.status).toBe(400)
    expect(((await res.json()) as { code: string }).code).toBe('invalid_argument')
    expect(mock).not.toHaveBeenCalled()
  })

  it('上游 4xx → invalid_argument;404 保留成 not_found', async () => {
    mockE2b(400, { message: 'invalid template' })
    const bad = await call('create_sandbox', { templateID: 'nope' })
    expect(bad.status).toBe(400)
    await expect(bad.json()).resolves.toMatchObject({
      code: 'invalid_argument',
      message: 'invalid template',
    })

    vi.unstubAllGlobals()
    mockE2b(404, { message: 'sandbox not found' })
    const missing = await call('get_sandbox', { sandboxID: 'sb-x' })
    expect(missing.status).toBe(404)
    await expect(missing.json()).resolves.toMatchObject({ code: 'not_found' })
  })

  it('上游 5xx → unavailable + retryable', async () => {
    mockE2b(503, { message: 'E2B unavailable' })
    await expect((await call('list_sandboxes', {})).json())
      .resolves.toMatchObject({ code: 'unavailable', retryable: true, message: 'E2B unavailable' })
  })

  it('错误消息依次落在 message / error / detail;都没有才退到状态码文案', async () => {
    mockE2b(400, { error: 'from error field' })
    await expect((await call('list_sandboxes', {})).json())
      .resolves.toMatchObject({ message: 'from error field' })

    vi.unstubAllGlobals()
    mockE2b(400, { detail: 'from detail field' })
    await expect((await call('list_sandboxes', {})).json())
      .resolves.toMatchObject({ message: 'from detail field' })

    vi.unstubAllGlobals()
    mockE2b(400, {})
    await expect((await call('list_sandboxes', {})).json())
      .resolves.toMatchObject({ message: 'E2B request failed with status 400' })
  })

  it('错误响应回的不是 JSON 时,原始文本就是消息', async () => {
    mockE2b(502, '<html>gateway</html>')
    await expect((await call('list_sandboxes', {})).json())
      .resolves.toMatchObject({ code: 'unavailable', message: '<html>gateway</html>' })
  })

  it('2xx 上回非 JSON → unavailable + retryable', async () => {
    mockE2b(200, 'not json')
    await expect((await call('list_sandboxes', {})).json())
      .resolves.toMatchObject({ code: 'unavailable', retryable: true, message: 'E2B returned invalid JSON' })
  })

  it('没配 authRef → unavailable 且不打上游', async () => {
    const mock = mockE2b(200, [])
    const res = await call('list_sandboxes', {}, { auth: null })
    expect(res.status).toBe(503)
    expect(((await res.json()) as { message: string }).message).toContain('authRef')
    expect(mock).not.toHaveBeenCalled()
  })
})
