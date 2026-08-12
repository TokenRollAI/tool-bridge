import {
  base64urlEncode,
  type CallContext,
  encodeCallContext,
  HEADER_TB_CONTEXT,
  HEADER_TB_UPSTREAM_AUTH,
} from '@tool-bridge/core'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod/v4'
import { createPivotalTrackerPlugin } from '../../src/pivotal_tracker/index'
import { pivotalTrackerActions } from '../../src/pivotal_tracker/schema'

/**
 * Pivotal Tracker 迁移产物的 wire 级验收。重点在几个"迁移最容易迁丢"的地方:
 * base URL 的 /services/v5 前缀不能被 `new URL` 吃掉、凭证走 X-TrackerToken 而非 Bearer、
 * labelNames 要展开成对象数组、生成 schema 漏掉的必填项在本地补挡。
 */

const PLUGIN_TOKEN = 'tbp_test'
const ENV = { PLUGIN_TOKEN }
const API_KEY = 'tracker_token_deadbeef'
const plugin = createPivotalTrackerPlugin()

const CALLER: CallContext = {
  keyId: 'k1',
  owner: 'agent:tester',
  scopes: [],
  traceId: 't1',
  mountPath: 'pm/pivotal',
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

function mockTracker(status: number, payload: unknown): ReturnType<typeof vi.fn> {
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
  it('List 出全部 9 个 action,且都带 Zod 派生的 schema', async () => {
    const res = await envelope({ tool: 'List', arguments: {} })
    const tools = (await res.json()) as Array<{ inputSchema?: unknown, name: string, outputSchema?: unknown }>
    expect(tools).toHaveLength(Object.keys(pivotalTrackerActions).length)
    expect(tools).toHaveLength(9)
    for (const tool of tools) {
      expect(tool.inputSchema, `${tool.name} 缺 inputSchema`).toBeDefined()
      expect(tool.outputSchema, `${tool.name} 缺 outputSchema`).toBeDefined()
    }
  })

  it('effect 播种值符合读写语义', async () => {
    const res = await envelope({ tool: 'List', arguments: {} })
    const tools = (await res.json()) as Array<{ effect?: string, name: string }>
    const effectOf = (name: string): string | undefined => tools.find(t => t.name === name)?.effect
    expect(effectOf('get_current_user')).toBe('read')
    expect(effectOf('list_projects')).toBe('read')
    expect(effectOf('list_story_comments')).toBe('read')
    expect(effectOf('create_story')).toBe('write')
    expect(effectOf('update_story_state')).toBe('write')
  })
})

describe('请求成形', () => {
  it('get_current_user:GET /services/v5/me,凭证走 X-TrackerToken', async () => {
    const mock = mockTracker(200, { id: 42, name: 'Ada', username: 'ada' })
    const res = await call('get_current_user', {})

    const request = sent(mock)
    expect(request.url).toBe('https://www.pivotaltracker.com/services/v5/me')
    expect(request.method).toBe('GET')
    expect(request.headers.get('X-TrackerToken')).toBe(API_KEY)
    // 凭证不是 Bearer,别把插件令牌误当上游凭证发出去。
    expect(request.headers.get('authorization')).toBeNull()
    expect(request.headers.get('accept')).toBe('application/json')
    // GET 没有 body,不该带 content-type。
    expect(request.headers.get('content-type')).toBeNull()
    await expect(res.json()).resolves.toEqual({
      content: { user: { id: 42, name: 'Ada', username: 'ada' } },
    })
  })

  it('list_projects:分页参数进 query,省略的不出现,数组挂在 projects 下', async () => {
    const mock = mockTracker(200, [{ id: 1, name: 'Apollo' }])
    const res = await call('list_projects', { limit: 10, offset: 20 })

    const url = new URL(sent(mock).url)
    expect(url.origin + url.pathname).toBe('https://www.pivotaltracker.com/services/v5/projects')
    expect(url.searchParams.get('limit')).toBe('10')
    expect(url.searchParams.get('offset')).toBe('20')
    expect(url.searchParams.has('fields')).toBe(false)
    await expect(res.json()).resolves.toEqual({ content: { projects: [{ id: 1, name: 'Apollo' }] } })
  })

  it('offset 为 0 时仍然发出去(0 不是"没给")', async () => {
    const mock = mockTracker(200, [])
    await call('list_projects', { offset: 0 })
    expect(new URL(sent(mock).url).searchParams.get('offset')).toBe('0')
  })

  it('list_project_stories:过滤器与分页参数一起进 query', async () => {
    const mock = mockTracker(200, [{ id: 7 }])
    await call('list_project_stories', {
      projectId: 123,
      filter: 'label:plans',
      withState: 'started',
      withStoryType: 'bug',
      limit: 5,
    })

    const url = new URL(sent(mock).url)
    expect(url.pathname).toBe('/services/v5/projects/123/stories')
    expect(url.searchParams.get('filter')).toBe('label:plans')
    expect(url.searchParams.get('with_state')).toBe('started')
    expect(url.searchParams.get('with_story_type')).toBe('bug')
    expect(url.searchParams.get('limit')).toBe('5')
  })

  it('get_story:项目与故事 ID 都拼进路径', async () => {
    const mock = mockTracker(200, { id: 7, name: 'Ship it' })
    const res = await call('get_story', { projectId: 123, storyId: 7, fields: 'name,url' })

    const url = new URL(sent(mock).url)
    expect(url.pathname).toBe('/services/v5/projects/123/stories/7')
    expect(url.searchParams.get('fields')).toBe('name,url')
    await expect(res.json()).resolves.toEqual({ content: { story: { id: 7, name: 'Ship it' } } })
  })

  it('create_story:labelNames 展开成对象数组,省略的可选字段不进 body', async () => {
    const mock = mockTracker(200, { id: 7, name: 'Ship it' })
    const res = await call('create_story', {
      projectId: 123,
      name: 'Ship it',
      storyType: 'feature',
      ownerIds: [1, 2],
      labelNames: ['plans', 'q3'],
    })

    const request = sent(mock)
    expect(request.url).toBe('https://www.pivotaltracker.com/services/v5/projects/123/stories')
    expect(request.method).toBe('POST')
    expect(request.headers.get('content-type')).toBe('application/json')
    await expect(request.json()).resolves.toEqual({
      name: 'Ship it',
      story_type: 'feature',
      owner_ids: [1, 2],
      labels: [{ name: 'plans' }, { name: 'q3' }],
    })
    await expect(res.json()).resolves.toEqual({ content: { story: { id: 7, name: 'Ship it' } } })
  })

  it('update_story_state:走 PUT,body 只带 current_state', async () => {
    const mock = mockTracker(200, { id: 7, current_state: 'finished' })
    const res = await call('update_story_state', {
      projectId: 123,
      storyId: 7,
      currentState: 'finished',
    })

    const request = sent(mock)
    expect(request.url).toBe('https://www.pivotaltracker.com/services/v5/projects/123/stories/7')
    expect(request.method).toBe('PUT')
    await expect(request.json()).resolves.toEqual({ current_state: 'finished' })
    await expect(res.json()).resolves.toEqual({
      content: { story: { id: 7, current_state: 'finished' } },
    })
  })

  it('create_story_comment:POST 到 /comments,body 只带 text', async () => {
    const mock = mockTracker(200, { id: 9, text: 'LGTM' })
    const res = await call('create_story_comment', { projectId: 123, storyId: 7, text: 'LGTM' })

    const request = sent(mock)
    expect(request.url)
      .toBe('https://www.pivotaltracker.com/services/v5/projects/123/stories/7/comments')
    expect(request.method).toBe('POST')
    await expect(request.json()).resolves.toEqual({ text: 'LGTM' })
    await expect(res.json()).resolves.toEqual({ content: { comment: { id: 9, text: 'LGTM' } } })
  })
})

describe('校验与错误', () => {
  it('入参校验真的生效:projectId 给 0 → 400 且不打上游', async () => {
    const mock = mockTracker(200, {})
    const res = await call('get_project', { projectId: 0 })
    expect(res.status).toBe(400)
    expect(((await res.json()) as { code: string }).code).toBe('invalid_argument')
    expect(mock).not.toHaveBeenCalled()
  })

  it('strictObject 挡住未知字段 → 400 且不打上游', async () => {
    const mock = mockTracker(200, {})
    expect((await call('list_projects', { per_page: 10 })).status).toBe(400)
    expect(mock).not.toHaveBeenCalled()
  })

  it('生成 schema 漏掉的必填项在本地补挡 → 400 且不打上游', async () => {
    const mock = mockTracker(200, {})
    const noIds = await call('update_story_state', { currentState: 'finished' })
    expect(noIds.status).toBe(400)
    expect(((await noIds.json()) as { message: string }).message).toContain('projectId')

    const noState = await call('update_story_state', { projectId: 1, storyId: 2 })
    expect(noState.status).toBe(400)
    expect(((await noState.json()) as { message: string }).message).toContain('currentState')

    const noText = await call('create_story_comment', { projectId: 1, storyId: 2 })
    expect(noText.status).toBe(400)
    expect(((await noText.json()) as { message: string }).message).toContain('text')

    expect(mock).not.toHaveBeenCalled()
  })

  it('list 类响应拿到非数组 → unavailable(上游破契约,不赖调用方)', async () => {
    mockTracker(200, { projects: [] })
    const res = await call('list_projects', {})
    expect(res.status).toBe(503)
    await expect(res.json()).resolves.toMatchObject({ code: 'unavailable', retryable: true })
  })

  it('上游错误按状态归一,消息取自 error 字段', async () => {
    mockTracker(404, { code: 'unfound_resource', error: 'The object you tried to access could not be found' })
    const missing = await call('get_story', { projectId: 1, storyId: 999 })
    expect(missing.status).toBe(404)
    await expect(missing.json()).resolves.toMatchObject({
      code: 'not_found',
      message: 'The object you tried to access could not be found',
    })

    mockTracker(401, { error: 'Invalid authentication credentials' })
    const unauthorized = await call('get_current_user', {})
    expect(unauthorized.status).toBe(401)
    await expect(unauthorized.json()).resolves.toMatchObject({
      code: 'permission_denied',
      message: 'Invalid authentication credentials',
    })

    mockTracker(429, { error: 'Rate limit exceeded' })
    const limited = await call('list_projects', {})
    expect(limited.status).toBe(429)
    await expect(limited.json()).resolves.toMatchObject({
      code: 'rate_limited',
      retryable: true,
    })

    mockTracker(500, {})
    await expect((await call('list_projects', {})).json())
      .resolves.toMatchObject({ code: 'unavailable', retryable: true })
  })

  it('传输层失败归一成 unavailable,而非裸 Error 抹成 internal 500', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('socket hang up'))))
    const res = await call('get_current_user', {})
    expect(res.status).toBe(503)
    await expect(res.json()).resolves.toMatchObject({
      code: 'unavailable',
      message: 'Pivotal Tracker 请求失败: socket hang up',
    })
  })

  it('没配 authRef → unavailable 且不打上游', async () => {
    const mock = mockTracker(200, {})
    const res = await call('get_current_user', {}, { auth: null })
    expect(res.status).toBe(503)
    expect(((await res.json()) as { message: string }).message).toContain('authRef')
    expect(mock).not.toHaveBeenCalled()
  })
})

describe('凭证探针(credentialProbe)', () => {
  it('~describe 报出探针工具名,平台据此在挂载时验凭证', async () => {
    const res = await createPivotalTrackerPlugin().fetch(
      new Request('https://p.test/~describe'),
      {} as never,
    )
    const body = (await res.json()) as { exports: Array<{ credentialProbe?: string, id: string }> }
    expect(body.exports[0]?.credentialProbe).toBe('get_current_user')
  })

  it('探针指向的工具确实存在、只读、且无必填入参(平台挂载时会空参调它)', async () => {
    const spec = pivotalTrackerActions.get_current_user
    expect(spec.effect).toBe('read')
    const schema = z.toJSONSchema(spec.inputSchema, { io: 'input' }) as { required?: string[] }
    expect(schema.required ?? []).toEqual([])
  })
})
