import {
  base64urlEncode,
  type CallContext,
  encodeCallContext,
  HEADER_TB_CONTEXT,
  HEADER_TB_UPSTREAM_AUTH,
} from '@tool-bridge/core'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createFfhubPlugin } from '../../src/ffhub/index'
import { ffhubActions } from '../../src/ffhub/schema'

/**
 * FFHub 迁移产物的 wire 级验收。重点:snake_case → camelCase 的重映射、
 * nullable 字段不能省键、路径参数编码、404 不再被压成 400。
 */

const PLUGIN_TOKEN = 'tbp_test'
const ENV = { PLUGIN_TOKEN }
const API_KEY = 'ffhub_test_deadbeef'
const plugin = createFfhubPlugin()

const CALLER: CallContext = {
  keyId: 'k1',
  owner: 'agent:tester',
  scopes: [],
  traceId: 't1',
  mountPath: 'media/ffhub',
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

function mockFfhub(status: number, payload: unknown): ReturnType<typeof vi.fn> {
  const fn = vi.fn(() => Promise.resolve(new Response(
    typeof payload === 'string' ? payload : JSON.stringify(payload),
    { status, headers: { 'content-type': 'application/json' } },
  )))
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
  it('List 出全部 3 个 action,且都带 Zod 派生的 schema', async () => {
    const res = await envelope({ tool: 'List', arguments: {} })
    const tools = (await res.json()) as Array<{ inputSchema?: unknown, name: string, outputSchema?: unknown }>
    expect(tools).toHaveLength(Object.keys(ffhubActions).length)
    expect(tools).toHaveLength(3)
    for (const tool of tools) {
      expect(tool.inputSchema, `${tool.name} 缺 inputSchema`).toBeDefined()
      expect(tool.outputSchema, `${tool.name} 缺 outputSchema`).toBeDefined()
    }
  })
})

describe('请求整形', () => {
  it('create_ffmpeg_task 打 POST /v1/tasks,body 用 snake_case,凭证走 Bearer', async () => {
    const mock = mockFfhub(200, { task_id: 'task_1' })
    const res = await call('create_ffmpeg_task', {
      command: '-i in.mp4 out.mp4',
      withMetadata: true,
    })

    const request = sent(mock)
    expect(request.url).toBe('https://api.ffhub.io/v1/tasks')
    expect(request.method).toBe('POST')
    expect(request.headers.get('authorization')).toBe(`Bearer ${API_KEY}`)
    await expect(request.json()).resolves.toEqual({
      command: '-i in.mp4 out.mp4',
      with_metadata: true,
    })
    await expect(res.json()).resolves.toEqual({ content: { taskId: 'task_1' } })
  })

  it('get_ffmpeg_task 编码路径参数,响应字段重映射成 camelCase 且 nullable 键不省', async () => {
    const mock = mockFfhub(200, {
      task_id: 'a/b',
      status: 'completed',
      user_id: 'u1',
      created_at: '2026-08-12T00:00:00Z',
      outputs: [{ filename: 'out.mp4', url: 'https://cdn.ffhub.io/out.mp4', size: 1024 }],
    })
    const res = await call('get_ffmpeg_task', { taskId: 'a/b' })

    expect(sent(mock).url).toBe('https://api.ffhub.io/v1/tasks/a%2Fb')
    await expect(res.json()).resolves.toEqual({
      content: {
        task: {
          taskId: 'a/b',
          userId: 'u1',
          status: 'completed',
          progress: null,
          error: null,
          elapsed: null,
          totalElapsed: null,
          createdAt: '2026-08-12T00:00:00Z',
          finishedAt: null,
          outputs: [{
            filename: 'out.mp4',
            url: 'https://cdn.ffhub.io/out.mp4',
            size: 1024,
            metadata: null,
          }],
        },
      },
    })
  })

  it('list_ffmpeg_tasks 把过滤条件放 query,未给的不发', async () => {
    const mock = mockFfhub(200, { tasks: [], total: 0 })
    await call('list_ffmpeg_tasks', { status: 'running', limit: 10, offset: 0 })

    const url = new URL(sent(mock).url)
    expect(url.pathname).toBe('/v1/tasks')
    expect(url.searchParams.get('status')).toBe('running')
    expect(url.searchParams.get('limit')).toBe('10')
    expect(url.searchParams.get('offset')).toBe('0')
    expect(url.searchParams.has('user_id')).toBe(false)
  })
})

describe('校验与错误', () => {
  it('入参校验生效:command 给空串 → 400 且不打上游', async () => {
    const mock = mockFfhub(200, {})
    const res = await call('create_ffmpeg_task', { command: '' })
    expect(res.status).toBe(400)
    expect(((await res.json()) as { code: string }).code).toBe('invalid_argument')
    expect(mock).not.toHaveBeenCalled()
  })

  it('纯空白的 command 过得了 Zod,但在拼请求体前被挡下', async () => {
    const mock = mockFfhub(200, { task_id: 'x' })
    const res = await call('create_ffmpeg_task', { command: '   ' })
    expect(res.status).toBe(400)
    expect(mock).not.toHaveBeenCalled()
  })

  it('上游错误按状态归一,404 保留成 not_found(上游把它压成 400)', async () => {
    mockFfhub(404, { message: 'task not found' })
    await expect((await call('get_ffmpeg_task', { taskId: 't1' })).json())
      .resolves.toMatchObject({ code: 'not_found', message: 'task not found' })

    mockFfhub(401, { error: 'invalid api key' })
    await expect((await call('list_ffmpeg_tasks', {})).json())
      .resolves.toMatchObject({ code: 'permission_denied', message: 'invalid api key' })

    mockFfhub(429, { message: 'slow down' })
    await expect((await call('list_ffmpeg_tasks', {})).json())
      .resolves.toMatchObject({ code: 'rate_limited', retryable: true })

    mockFfhub(500, { message: 'ffhub is down' })
    await expect((await call('list_ffmpeg_tasks', {})).json())
      .resolves.toMatchObject({ code: 'unavailable', retryable: true })
  })

  it('上游少了契约必有字段 → unavailable(是上游坏了,不是调用方的错)', async () => {
    mockFfhub(200, { tasks: [{ task_id: 't1', status: 'running' }] })
    await expect((await call('list_ffmpeg_tasks', {})).json())
      .resolves.toMatchObject({ code: 'unavailable' })
  })

  it('没配 authRef → unavailable 且不打上游', async () => {
    const mock = mockFfhub(200, { tasks: [], total: 0 })
    const res = await call('list_ffmpeg_tasks', {}, { auth: null })
    expect(res.status).toBe(503)
    expect(((await res.json()) as { message: string }).message).toContain('authRef')
    expect(mock).not.toHaveBeenCalled()
  })
})
