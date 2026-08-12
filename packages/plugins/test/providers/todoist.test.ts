import {
  base64urlEncode,
  type CallContext,
  encodeCallContext,
  HEADER_TB_CONTEXT,
  HEADER_TB_UPSTREAM_AUTH,
} from '@tool-bridge/core'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod/v4'
import { createTodoistPlugin } from '../../src/todoist/index'
import { todoistActions } from '../../src/todoist/schema'

/**
 * Todoist(API v1)迁移产物的 wire 级验收。重点钉住几处"迁移最容易迁丢"的地方:
 * 写操作全是 POST(不是 PATCH/PUT)、update 的三态字段(null 表示清空,不能被"空即无"吃掉)、
 * opaque cursor 分页与 `results` 缺失的归一、`ids` 发成逗号串、评论附件的双键归一、
 * 以及 schema 声明接受但上游静默丢掉的 folderId 字符串形态。
 */

const PLUGIN_TOKEN = 'tbp_test'
const ENV = { PLUGIN_TOKEN }
const API_KEY = 'todoist_token_deadbeef'
const API_BASE = 'https://api.todoist.com/api/v1'
const plugin = createTodoistPlugin()

const CALLER: CallContext = {
  keyId: 'k1',
  owner: 'agent:tester',
  scopes: [],
  traceId: 't1',
  mountPath: 'tasks/todoist',
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

function mockTodoist(status: number, payload: unknown): ReturnType<typeof vi.fn> {
  const body = typeof payload === 'string' ? payload : JSON.stringify(payload)
  const fn = vi.fn(() => Promise.resolve(new Response(body, {
    status,
    headers: { 'content-type': 'application/json' },
  })))
  vi.stubGlobal('fetch', fn)
  return fn
}

/** 空体响应(close_task 的 204):`new Response('', {status:204})` 在 undici 下会 TypeError。 */
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
  it('List 出全部 19 个 action,且都带 Zod 派生的 schema', async () => {
    const res = await envelope({ tool: 'List', arguments: {} })
    const tools = (await res.json()) as Array<{ inputSchema?: unknown, name: string, outputSchema?: unknown }>
    expect(tools).toHaveLength(Object.keys(todoistActions).length)
    expect(tools).toHaveLength(19)
    expect(tools.map(tool => tool.name).sort()).toEqual([
      'close_task',
      'create_comment',
      'create_project',
      'create_section',
      'create_task',
      'get_comment',
      'get_current_user',
      'get_project',
      'get_section',
      'get_task',
      'list_comments',
      'list_labels',
      'list_projects',
      'list_sections',
      'list_tasks',
      'update_comment',
      'update_project',
      'update_section',
      'update_task',
    ])
    for (const tool of tools) {
      expect(tool.inputSchema, `${tool.name} 缺 inputSchema`).toBeDefined()
      expect(tool.outputSchema, `${tool.name} 缺 outputSchema`).toBeDefined()
    }
  })

  it('~describe 报成单个 tools/v1 export,带探针工具名', async () => {
    const res = await plugin.fetch(new Request('https://plugin.test/~describe'), ENV as never)
    const body = (await res.json()) as { exports: Array<{ credentialProbe?: string, profile: string }> }
    expect(body.exports).toHaveLength(1)
    expect(body.exports[0]?.profile).toBe('tools/v1')
    expect(body.exports[0]?.credentialProbe).toBe('get_current_user')
  })

  it('探针指向的工具确实存在、只读、且无必填入参(平台挂载时会空参调它)', () => {
    const spec = todoistActions.get_current_user
    expect(spec.effect).toBe('read')
    const schema = z.toJSONSchema(spec.inputSchema, { io: 'input' }) as { required?: string[] }
    expect(schema.required ?? []).toEqual([])
  })
})

describe('请求拼装', () => {
  it('get_current_user:GET /user,token 走 Bearer 头,GET 无请求体也无 content-type', async () => {
    const mock = mockTodoist(200, { id: '42', email: 'a@b.c' })
    await call('get_current_user', {})
    const request = sent(mock)
    expect(request.method).toBe('GET')
    expect(request.url).toBe(`${API_BASE}/user`)
    expect(request.headers.get('authorization')).toBe(`Bearer ${API_KEY}`)
    expect(request.headers.get('accept')).toBe('application/json')
    expect(request.headers.get('content-type')).toBeNull()
    expect(await request.text()).toBe('')
  })

  it('list_projects:筛选与分页进 query,未给的键不出现', async () => {
    const mock = mockTodoist(200, { results: [], next_cursor: null })
    await call('list_projects', { folderId: 7, cursor: 'abc', limit: 50 })
    const url = new URL(sent(mock).url)
    expect(url.pathname).toBe('/api/v1/projects')
    expect(Object.fromEntries(url.searchParams)).toEqual({ folder_id: '7', cursor: 'abc', limit: '50' })
  })

  it('folderId 的字符串形态也发出去(schema 声明接受;上游 optionalInteger 会静默丢掉它)', async () => {
    const mock = mockTodoist(200, { results: [] })
    await call('list_projects', { folderId: '220325', workspaceId: '9' })
    const params = new URL(sent(mock).url).searchParams
    expect(params.get('folder_id')).toBe('220325')
    expect(params.get('workspace_id')).toBe('9')
  })

  it('list_tasks 的 ids 发成**逗号串**(不是重复的同名参数)', async () => {
    const mock = mockTodoist(200, { results: [] })
    await call('list_tasks', { ids: ['1', '2', '3'], projectId: 'p1' })
    const params = new URL(sent(mock).url).searchParams
    expect(params.getAll('ids')).toEqual(['1,2,3'])
    expect(params.get('project_id')).toBe('p1')
  })

  it('id 进路径要 URL 编码', async () => {
    const mock = mockTodoist(200, { id: 't1' })
    await call('get_task', { taskId: 'a/b' })
    expect(new URL(sent(mock).url).pathname).toBe('/api/v1/tasks/a%2Fb')
  })

  it('create_task:POST /tasks,入参驼峰转 snake_case,带 content-type', async () => {
    const mock = mockTodoist(200, { id: 't1', content: 'Buy milk' })
    await call('create_task', {
      content: 'Buy milk',
      description: 'from the corner shop',
      projectId: 'p1',
      sectionId: 's1',
      parentId: 'x1',
      order: 3,
      labels: ['errand', 'home'],
      priority: 4,
      assigneeId: 99,
      dueString: 'tomorrow at 9',
      dueDate: '2026-02-01',
      dueLang: 'en',
      duration: 30,
      durationUnit: 'minute',
      deadlineDate: '2026-02-03',
      childOrder: 1,
      isCollapsed: false,
      dayOrder: 2,
    })

    const request = sent(mock)
    expect(request.method).toBe('POST')
    expect(request.url).toBe(`${API_BASE}/tasks`)
    expect(request.headers.get('content-type')).toBe('application/json')
    await expect(request.json()).resolves.toEqual({
      content: 'Buy milk',
      description: 'from the corner shop',
      project_id: 'p1',
      section_id: 's1',
      parent_id: 'x1',
      order: 3,
      labels: ['errand', 'home'],
      priority: 4,
      assignee_id: 99,
      due_string: 'tomorrow at 9',
      due_date: '2026-02-01',
      due_lang: 'en',
      duration: 30,
      duration_unit: 'minute',
      deadline_date: '2026-02-03',
      child_order: 1,
      is_collapsed: false,
      day_order: 2,
    })
  })

  it('update_task / update_project / update_section 都是 **POST**(v1 没有 PATCH)', async () => {
    for (const [action, args, path] of [
      ['update_task', { taskId: 't1', content: 'x' }, '/api/v1/tasks/t1'],
      ['update_project', { projectId: 'p1', name: 'x' }, '/api/v1/projects/p1'],
      ['update_section', { sectionId: 's1', name: 'x' }, '/api/v1/sections/s1'],
    ] as const) {
      const mock = mockTodoist(200, { id: '1' })
      await call(action, args)
      const request = sent(mock)
      expect(request.method, action).toBe('POST')
      expect(new URL(request.url).pathname, action).toBe(path)
      vi.unstubAllGlobals()
    }
  })

  it('update 的字段是三态:未给的键不发,null 原样发出去(表示清空)', async () => {
    const mock = mockTodoist(200, { id: 'p1' })
    await call('update_project', { projectId: 'p1', description: null, isFavorite: false, folderId: null })
    await expect(sent(mock).json()).resolves.toEqual({
      description: null,
      is_favorite: false,
      folder_id: null,
    })
  })

  it('create_project:parentId 给 null 时原样发(建成顶层项目),未给则不发这个键', async () => {
    const withNull = mockTodoist(200, { id: 'p1' })
    await call('create_project', { name: 'Work', parentId: null })
    await expect(sent(withNull).json()).resolves.toEqual({ name: 'Work', parent_id: null })

    vi.unstubAllGlobals()
    const without = mockTodoist(200, { id: 'p1' })
    await call('create_project', { name: 'Work' })
    await expect(sent(without).json()).resolves.toEqual({ name: 'Work' })
  })

  it('create_comment:attachment 转 snake_case,uidsToNotify 只留整数', async () => {
    const mock = mockTodoist(200, { id: 'c1', content: 'hi' })
    await call('create_comment', {
      content: 'hi',
      taskId: 't1',
      attachment: { fileUrl: 'https://cdn.example.com/a.pdf', fileName: 'a.pdf', fileType: 'application/pdf' },
      uidsToNotify: [1, 2],
    })
    await expect(sent(mock).json()).resolves.toEqual({
      content: 'hi',
      task_id: 't1',
      attachment: {
        file_url: 'https://cdn.example.com/a.pdf',
        file_name: 'a.pdf',
        file_type: 'application/pdf',
      },
      uids_to_notify: [1, 2],
    })
  })

  it('close_task:POST /tasks/<id>/close,无请求体,出参恒为 {success:true}', async () => {
    const mock = mockEmpty(204)
    const res = await call('close_task', { taskId: 't1' })
    const request = sent(mock)
    expect(request.method).toBe('POST')
    expect(new URL(request.url).pathname).toBe('/api/v1/tasks/t1/close')
    expect(request.headers.get('content-type')).toBeNull()
    await expect(res.json()).resolves.toEqual({ content: { success: true } })
  })
})

describe('分页与响应整形', () => {
  it('list 出参是 {<集合>, nextCursor};非对象项被丢掉', async () => {
    mockTodoist(200, { results: [{ id: 'p1' }, 'garbage', { id: 'p2' }], next_cursor: 'next-page' })
    await expect((await call('list_projects', {})).json()).resolves.toEqual({
      content: { projects: [{ id: 'p1' }, { id: 'p2' }], nextCursor: 'next-page' },
    })
  })

  it('next_cursor 缺失或为 null 时 nextCursor 给 null(不是省略键)', async () => {
    mockTodoist(200, { results: [] })
    await expect((await call('list_labels', {})).json())
      .resolves.toEqual({ content: { labels: [], nextCursor: null } })

    vi.unstubAllGlobals()
    mockTodoist(200, { results: [], next_cursor: null })
    await expect((await call('list_labels', {})).json())
      .resolves.toEqual({ content: { labels: [], nextCursor: null } })
  })

  it('results 缺失 → unavailable + retryable(list 端点的契约破了)', async () => {
    mockTodoist(200, { projects: [{ id: 'p1' }] })
    await expect((await call('list_projects', {})).json())
      .resolves.toMatchObject({ code: 'unavailable', retryable: true })
  })

  it('评论的附件两个键都认(attachment / file_attachment),归一到 attachment', async () => {
    mockTodoist(200, { id: 'c1', content: 'hi', file_attachment: { file_name: 'a.pdf' } })
    await expect((await call('get_comment', { commentId: 'c1' })).json()).resolves.toEqual({
      content: { comment: { id: 'c1', content: 'hi', file_attachment: { file_name: 'a.pdf' }, attachment: { file_name: 'a.pdf' } } },
    })

    vi.unstubAllGlobals()
    mockTodoist(200, { results: [{ id: 'c1', attachment: null }], next_cursor: null })
    // attachment 是 null 时归一后这个键被丢掉(上游 compactObject 的行为)。
    await expect((await call('list_comments', { taskId: 't1' })).json())
      .resolves.toEqual({ content: { comments: [{ id: 'c1' }], nextCursor: null } })
  })
})

describe('校验与错误', () => {
  it('生成的 schema 里 optional 的 id,必填断言留在本层:缺 taskId → invalid_argument 且不打上游', async () => {
    const mock = mockTodoist(200, {})
    const res = await call('get_task', {})
    expect(res.status).toBe(400)
    await expect(res.json()).resolves.toMatchObject({
      code: 'invalid_argument',
      message: 'taskId is required.',
    })
    expect(mock).not.toHaveBeenCalled()
  })

  it('update_comment 的 content 也是本层必填(schema 里它是 optional)', async () => {
    const mock = mockTodoist(200, {})
    const res = await call('update_comment', { commentId: 'c1' })
    expect(res.status).toBe(400)
    await expect(res.json()).resolves.toMatchObject({ message: 'content is required.' })
    expect(mock).not.toHaveBeenCalled()
  })

  it('入参校验真的生效:limit 越界 / priority 越界 → 400 且不打上游', async () => {
    const mock = mockTodoist(200, {})
    expect((await call('list_tasks', { limit: 500 })).status).toBe(400)
    expect((await call('create_task', { content: 'x', priority: 9 })).status).toBe(400)
    expect(mock).not.toHaveBeenCalled()
  })

  it('4xx 归 invalid_argument,消息取自 error 字段', async () => {
    mockTodoist(400, { error: 'Invalid argument value' })
    const res = await call('create_task', { content: 'x', projectId: 'nope' })
    expect(res.status).toBe(400)
    await expect(res.json()).resolves.toMatchObject({
      code: 'invalid_argument',
      message: 'Invalid argument value',
    })
  })

  it('401 归 permission_denied;404 保留成 not_found(上游把它压成 400,这里不跟)', async () => {
    mockTodoist(401, { error: 'Invalid token' })
    const unauthorized = await call('list_projects', {})
    expect(unauthorized.status).toBe(401)
    await expect(unauthorized.json()).resolves.toMatchObject({ code: 'permission_denied' })

    vi.unstubAllGlobals()
    mockTodoist(404, { error: 'Task not found' })
    const missing = await call('get_task', { taskId: 'nope' })
    expect(missing.status).toBe(404)
    await expect(missing.json()).resolves.toMatchObject({ code: 'not_found', message: 'Task not found' })
  })

  it('429 → rate_limited + retryable;5xx → unavailable + retryable', async () => {
    mockTodoist(429, { error: 'Too many requests' })
    await expect((await call('list_projects', {})).json())
      .resolves.toMatchObject({ code: 'rate_limited', retryable: true })

    vi.unstubAllGlobals()
    mockTodoist(500, { error: 'Todoist is down' })
    await expect((await call('list_projects', {})).json())
      .resolves.toMatchObject({ code: 'unavailable', retryable: true, message: 'Todoist is down' })
  })

  it('错误文案按 error → error_description → message → detail → errors[0] 取', async () => {
    mockTodoist(400, { errors: ['first problem', 'second problem'] })
    await expect((await call('list_projects', {})).json())
      .resolves.toMatchObject({ message: 'first problem' })

    vi.unstubAllGlobals()
    mockTodoist(400, {})
    await expect((await call('list_projects', {})).json())
      .resolves.toMatchObject({ message: 'todoist request failed with 400' })
  })

  it('错误体不是 JSON 时,原文进 message', async () => {
    mockTodoist(502, '<html>Bad Gateway</html>')
    await expect((await call('list_projects', {})).json())
      .resolves.toMatchObject({ code: 'unavailable', message: '<html>Bad Gateway</html>' })
  })

  it('该回对象的端点回了数组 → unavailable + retryable', async () => {
    mockTodoist(200, [1, 2, 3])
    await expect((await call('get_project', { projectId: 'p1' })).json())
      .resolves.toMatchObject({ code: 'unavailable', retryable: true })
  })

  it('没配 authRef → unavailable 且不打上游', async () => {
    const mock = mockTodoist(200, {})
    const res = await call('list_projects', {}, { auth: null })
    expect(res.status).toBe(503)
    expect(((await res.json()) as { message: string }).message).toContain('authRef')
    expect(mock).not.toHaveBeenCalled()
  })
})
