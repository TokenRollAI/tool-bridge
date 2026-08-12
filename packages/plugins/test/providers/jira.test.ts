import {
  base64urlEncode,
  type CallContext,
  encodeCallContext,
  encodeCredentialValues,
  HEADER_TB_CONTEXT,
  HEADER_TB_UPSTREAM_AUTH,
} from '@tool-bridge/core'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod/v4'
import { createJiraPlugin } from '../../src/jira/index'
import { jiraActions } from '../../src/jira/schema'

/**
 * Jira(Data Center / PAT)迁移产物的 wire 级验收。重点钉住几处"迁移最容易迁丢"的地方:
 * baseUrl 归一(粘贴 API 地址不能双拼、内网地址要被拦且消息看得懂)、
 * `fields` 在 POST /search 与 GET /issue 上的两种形状、DC 的内存分页、
 * 评论正文是纯文本(ADF 要拍平)、以及 create_issue 跟着 self 回查时的目标校验。
 */

const PLUGIN_TOKEN = 'tbp_test'
const ENV = { PLUGIN_TOKEN }
const CREDENTIALS = {
  baseUrl: 'https://jira.example.com',
  personalAccessToken: 'pat_deadbeef',
}
const API_BASE = 'https://jira.example.com/rest/api/2'
const plugin = createJiraPlugin()

const CALLER: CallContext = {
  keyId: 'k1',
  owner: 'agent:tester',
  scopes: [],
  traceId: 't1',
  mountPath: 'work/jira',
  exportId: 'actions',
}

function envelope(body: unknown, opts: { auth?: string | null } = {}): Promise<Response> {
  const headers: Record<string, string> = {
    'authorization': `Bearer ${PLUGIN_TOKEN}`,
    'content-type': 'application/json',
    [HEADER_TB_CONTEXT]: encodeCallContext(CALLER),
  }
  const auth = opts.auth === undefined ? encodeCredentialValues(CREDENTIALS) : opts.auth
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

function mockJira(status: number, payload: unknown): ReturnType<typeof vi.fn> {
  const body = typeof payload === 'string' ? payload : JSON.stringify(payload)
  const fn = vi.fn(() => Promise.resolve(new Response(body, {
    status,
    headers: { 'content-type': 'application/json' },
  })))
  vi.stubGlobal('fetch', fn)
  return fn
}

/** 依次回多份响应(create_issue 会打两次上游)。 */
function mockJiraSequence(...responses: Array<{ payload: unknown, status?: number }>): ReturnType<typeof vi.fn> {
  let index = 0
  const fn = vi.fn(() => {
    const next = responses[Math.min(index, responses.length - 1)]!
    index += 1
    return Promise.resolve(new Response(JSON.stringify(next.payload), {
      status: next.status ?? 200,
      headers: { 'content-type': 'application/json' },
    }))
  })
  vi.stubGlobal('fetch', fn)
  return fn
}

/** 取上游收到的第 n 个请求(默认第一个)。 */
function sent(mock: ReturnType<typeof vi.fn>, index = 0): Request {
  return (mock.mock.calls[index] as [Request])[0]
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('契约面', () => {
  it('List 出全部 7 个 action,且都带 Zod 派生的 schema', async () => {
    const res = await envelope({ tool: 'List', arguments: {} })
    const tools = (await res.json()) as Array<{ inputSchema?: unknown, name: string, outputSchema?: unknown }>
    expect(tools).toHaveLength(Object.keys(jiraActions).length)
    expect(tools).toHaveLength(7)
    expect(tools.map(tool => tool.name).sort()).toEqual([
      'add_comment',
      'create_issue',
      'get_issue',
      'get_project',
      'list_issue_comments',
      'list_projects',
      'search_issues',
    ])
    for (const tool of tools) {
      expect(tool.inputSchema, `${tool.name} 缺 inputSchema`).toBeDefined()
      expect(tool.outputSchema, `${tool.name} 缺 outputSchema`).toBeDefined()
    }
  })

  it('~describe 报成单个 tools/v1 export,带两字段凭证声明与探针工具名', async () => {
    const res = await plugin.fetch(new Request('https://plugin.test/~describe'), ENV as never)
    const body = (await res.json()) as {
      exports: Array<{ credentialFields?: Array<{ key: string }>, credentialProbe?: string }>
    }
    expect(body.exports).toHaveLength(1)
    expect(body.exports[0]?.credentialFields?.map(field => field.key))
      .toEqual(['baseUrl', 'personalAccessToken'])
    expect(body.exports[0]?.credentialProbe).toBe('list_projects')
  })

  it('探针指向的工具确实存在、只读、且无必填入参(平台挂载时会空参调它)', () => {
    const spec = jiraActions.list_projects
    expect(spec.effect).toBe('read')
    const schema = z.toJSONSchema(spec.inputSchema, { io: 'input' }) as { required?: string[] }
    expect(schema.required ?? []).toEqual([])
  })
})

describe('baseUrl 归一(它同时是出站边界)', () => {
  it('实例根地址拼成 /rest/api/2,PAT 走 Bearer', async () => {
    const mock = mockJira(200, [])
    await call('list_projects', {})
    const request = sent(mock)
    expect(request.url).toBe(`${API_BASE}/project`)
    expect(request.headers.get('authorization')).toBe(`Bearer ${CREDENTIALS.personalAccessToken}`)
    expect(request.headers.get('accept')).toBe('application/json')
  })

  it('用户粘了个 API 地址时先摘掉再钉 v2,不双拼', async () => {
    const mock = mockJira(200, [])
    await call('list_projects', {}, {
      auth: encodeCredentialValues({ ...CREDENTIALS, baseUrl: 'https://jira.example.com/rest/api/3/' }),
    })
    expect(sent(mock).url).toBe(`${API_BASE}/project`)
  })

  it('带部署上下文路径的实例地址保留那段路径', async () => {
    const mock = mockJira(200, [])
    await call('list_projects', {}, {
      auth: encodeCredentialValues({ ...CREDENTIALS, baseUrl: 'https://corp.example.com/jira' }),
    })
    expect(sent(mock).url).toBe('https://corp.example.com/jira/rest/api/2/project')
  })

  it('query 与 fragment 被剥掉', async () => {
    const mock = mockJira(200, [])
    await call('list_projects', {}, {
      auth: encodeCredentialValues({ ...CREDENTIALS, baseUrl: 'https://jira.example.com/?a=1#frag' }),
    })
    expect(sent(mock).url).toBe(`${API_BASE}/project`)
  })

  it('内网地址被拦下,且消息说清是凭证里的 baseUrl 触发的(不回显那个值)', async () => {
    const mock = mockJira(200, [])
    const res = await call('list_projects', {}, {
      auth: encodeCredentialValues({ ...CREDENTIALS, baseUrl: 'http://169.254.169.254/jira' }),
    })
    expect(res.status).toBe(400)
    const body = (await res.json()) as { code: string, message: string }
    expect(body.code).toBe('invalid_argument')
    expect(body.message).toContain('baseUrl')
    expect(body.message).toContain('SSRF')
    expect(body.message).not.toContain('169.254.169.254')
    expect(mock).not.toHaveBeenCalled()
  })

  it('baseUrl 内嵌凭证 → invalid_argument 且不打上游', async () => {
    const mock = mockJira(200, [])
    const res = await call('list_projects', {}, {
      auth: encodeCredentialValues({ ...CREDENTIALS, baseUrl: 'https://user:pw@jira.example.com' }),
    })
    expect(res.status).toBe(400)
    expect(((await res.json()) as { message: string }).message).toContain('baseUrl')
    expect(mock).not.toHaveBeenCalled()
  })

  it('缺 personalAccessToken → 400 且点名缺哪个,不裸调上游', async () => {
    const mock = mockJira(200, [])
    const res = await call('list_projects', {}, {
      auth: encodeCredentialValues({ baseUrl: 'https://jira.example.com' }),
    })
    expect(res.status).toBe(400)
    expect(((await res.json()) as { message: string }).message).toContain('personalAccessToken')
    expect(mock).not.toHaveBeenCalled()
  })

  it('没配 authRef → unavailable 且不打上游', async () => {
    const mock = mockJira(200, [])
    const res = await call('list_projects', {}, { auth: null })
    expect(res.status).toBe(503)
    expect(((await res.json()) as { message: string }).message).toContain('authRef')
    expect(mock).not.toHaveBeenCalled()
  })
})

describe('请求拼装', () => {
  it('search_issues:POST /search,fields 与 expand 都是**数组**(DC 的 SearchRequestBean)', async () => {
    const mock = mockJira(200, { issues: [], total: 0 })
    await call('search_issues', {
      jql: 'project = DEV',
      limit: 10,
      includeFields: ['customfield_1', 'summary'],
      expand: ['renderedFields'],
    })

    const request = sent(mock)
    expect(request.method).toBe('POST')
    expect(request.url).toBe(`${API_BASE}/search`)
    const body = (await request.json()) as { expand: unknown, fields: string[], maxResults: number, startAt: number }
    expect(body.maxResults).toBe(10)
    expect(body.startAt).toBe(0)
    expect(body.expand).toEqual(['renderedFields'])
    // 默认字段在前,includeFields 追加且去重(summary 已在默认里,不重复)。
    expect(body.fields).toEqual([
      'summary',
      'description',
      'status',
      'issuetype',
      'project',
      'assignee',
      'reporter',
      'priority',
      'labels',
      'created',
      'updated',
      'duedate',
      'customfield_1',
    ])
  })

  it('get_issue:同一份字段表在这里是**逗号串**,走 query', async () => {
    const mock = mockJira(200, { id: '1', key: 'DEV-1', fields: {} })
    await call('get_issue', { issueIdOrKey: 'DEV-1', includeFields: ['customfield_1'], expand: ['changelog'] })
    const url = new URL(sent(mock).url)
    expect(url.pathname).toBe('/rest/api/2/issue/DEV-1')
    expect(url.searchParams.get('fields'))
      .toBe('summary,description,status,issuetype,project,assignee,reporter,priority,labels,created,updated,duedate,customfield_1')
    expect(url.searchParams.get('expand')).toBe('changelog')
  })

  it('issue key 进路径要 URL 编码', async () => {
    const mock = mockJira(200, { id: '1', fields: {} })
    await call('get_issue', { issueIdOrKey: 'DEV/1' })
    expect(new URL(sent(mock).url).pathname).toBe('/rest/api/2/issue/DEV%2F1')
  })

  it('list_issue_comments 把 limit/cursor 发成 maxResults/startAt', async () => {
    const mock = mockJira(200, { comments: [], total: 0 })
    await call('list_issue_comments', { issueIdOrKey: 'DEV-1', limit: 5, cursor: '10' })
    const url = new URL(sent(mock).url)
    expect(url.pathname).toBe('/rest/api/2/issue/DEV-1/comment')
    expect(Object.fromEntries(url.searchParams)).toEqual({ maxResults: '5', startAt: '10' })
  })
})

describe('create_issue', () => {
  it('project/issuetype 拼成引用对象,extraFields 在前被显式入参覆盖,随后按 key 回查', async () => {
    const mock = mockJiraSequence(
      { payload: { id: '10001', key: 'DEV-7', self: `${API_BASE}/issue/10001` } },
      { payload: { id: '10001', key: 'DEV-7', fields: { summary: 'Created' } } },
    )
    const res = await call('create_issue', {
      projectKey: 'DEV',
      issueTypeName: 'Task',
      summary: 'Real summary',
      descriptionText: 'plain text',
      dueDate: '2026-01-31',
      priorityId: '3',
      assigneeAccountId: 'jdoe',
      parentIssueKey: 'DEV-1',
      extraFields: { summary: 'should be overridden', customfield_9: 'kept' },
    })

    expect(mock).toHaveBeenCalledTimes(2)
    const created = (await sent(mock).json()) as { fields: Record<string, unknown> }
    expect(created.fields).toEqual({
      customfield_9: 'kept',
      project: { key: 'DEV' },
      issuetype: { name: 'Task' },
      summary: 'Real summary',
      description: 'plain text',
      labels: [],
      // DC 按 name 认人,不是 Cloud 的 accountId。
      assignee: { name: 'jdoe' },
      priority: { id: '3' },
      duedate: '2026-01-31',
      parent: { key: 'DEV-1' },
    })

    // 第二跳按 key 回查完整 issue。
    expect(new URL(sent(mock, 1).url).pathname).toBe('/rest/api/2/issue/DEV-7')
    await expect(res.json()).resolves.toMatchObject({
      content: { issue: { id: '10001', key: 'DEV-7', summary: 'Created' } },
    })
  })

  it('projectId 优先于 projectKey,issueTypeId 优先于 issueTypeName', async () => {
    const mock = mockJiraSequence(
      { payload: { key: 'DEV-8' } },
      { payload: { key: 'DEV-8', fields: {} } },
    )
    await call('create_issue', {
      projectKey: 'DEV',
      projectId: '10000',
      issueTypeName: 'Task',
      issueTypeId: '3',
      summary: 'x',
    })
    const body = (await sent(mock).json()) as { fields: { issuetype: unknown, project: unknown } }
    expect(body.fields.project).toEqual({ id: '10000' })
    expect(body.fields.issuetype).toEqual({ id: '3' })
  })

  it('project 与 issuetype 都没给 → invalid_argument 且不打上游', async () => {
    const mock = mockJira(200, {})
    const noProject = await call('create_issue', { issueTypeName: 'Task', summary: 'x' })
    expect(noProject.status).toBe(400)
    await expect(noProject.json()).resolves.toMatchObject({
      code: 'invalid_argument',
      message: 'projectKey or projectId is required',
    })

    const noType = await call('create_issue', { projectKey: 'DEV', summary: 'x' })
    expect(noType.status).toBe(400)
    await expect(noType.json()).resolves.toMatchObject({ message: 'issueTypeId or issueTypeName is required' })
    expect(mock).not.toHaveBeenCalled()
  })

  it('ADF description 在 DC 上拍平成纯文本', async () => {
    const mock = mockJiraSequence(
      { payload: { key: 'DEV-9' } },
      { payload: { key: 'DEV-9', fields: {} } },
    )
    await call('create_issue', {
      projectKey: 'DEV',
      issueTypeName: 'Task',
      summary: 'x',
      description: {
        type: 'doc',
        version: 1,
        content: [
          { type: 'paragraph', content: [{ type: 'text', text: 'first line' }] },
          { type: 'paragraph', content: [{ type: 'text', text: 'second line' }] },
        ],
      },
    })
    const body = (await sent(mock).json()) as { fields: { description: string } }
    expect(body.fields.description).toBe('first line\nsecond line')
  })

  it('上游 self 指向 base URL 之外时拒绝跟随(不让上游指哪打哪)', async () => {
    const mock = mockJiraSequence({ payload: { self: 'https://evil.example.com/rest/api/2/issue/1' } })
    const res = await call('create_issue', { projectKey: 'DEV', issueTypeName: 'Task', summary: 'x' })
    expect(res.status).toBe(400)
    expect(((await res.json()) as { message: string }).message).toContain('must target')
    // 只打了创建那一跳,回查被挡住。
    expect(mock).toHaveBeenCalledTimes(1)
  })

  it('创建响应连 id/key/self 都没有 → unavailable(契约破了)', async () => {
    mockJiraSequence({ payload: {} })
    await expect((await call('create_issue', { projectKey: 'DEV', issueTypeName: 'Task', summary: 'x' })).json())
      .resolves.toMatchObject({ code: 'unavailable', retryable: true })
  })
})

describe('add_comment', () => {
  it('DC 的评论正文是纯文本字符串,不是 ADF 对象', async () => {
    const mock = mockJira(201, { id: '1', body: 'hello', created: '2026-01-01T00:00:00.000+0000' })
    const res = await call('add_comment', { issueIdOrKey: 'DEV-1', bodyText: 'hello' })
    expect(sent(mock).method).toBe('POST')
    await expect(sent(mock).json()).resolves.toEqual({ body: 'hello' })
    await expect(res.json()).resolves.toMatchObject({ content: { comment: { id: '1', body: 'hello' } } })
  })

  it('递了 ADF 文档就拍平:行内 mention/inlineCard 取 attrs,hardBreak 换行,词间空格不丢', async () => {
    const mock = mockJira(201, { id: '2' })
    await call('add_comment', {
      issueIdOrKey: 'DEV-1',
      body: {
        type: 'doc',
        version: 1,
        content: [{
          type: 'paragraph',
          content: [
            { type: 'text', text: 'ping ' },
            { type: 'mention', attrs: { id: 'u1', text: '@jdoe' } },
            { type: 'hardBreak' },
            { type: 'inlineCard', attrs: { url: 'https://example.com/x' } },
          ],
        }],
      },
    })
    // 上游对每个 text 节点套了会 trim 的 optionalString,拼出来是 "ping@jdoe";
    // 这里节点内文本原样取用,只在整篇拼完后 trim 一次。
    await expect(sent(mock).json()).resolves.toEqual({ body: 'ping @jdoe\nhttps://example.com/x' })
  })

  it('body 与 bodyText 都没给 → invalid_argument 且不打上游', async () => {
    const mock = mockJira(200, {})
    const res = await call('add_comment', { issueIdOrKey: 'DEV-1' })
    expect(res.status).toBe(400)
    await expect(res.json()).resolves.toMatchObject({
      code: 'invalid_argument',
      message: 'comment body or bodyText is required',
    })
    expect(mock).not.toHaveBeenCalled()
  })

  it('ADF 拍平后是空串(只有空节点)也拒绝 —— 免得创建一条空评论', async () => {
    const mock = mockJira(200, {})
    const res = await call('add_comment', {
      issueIdOrKey: 'DEV-1',
      body: { type: 'doc', version: 1, content: [{ type: 'rule' }] },
    })
    expect(res.status).toBe(400)
    expect(mock).not.toHaveBeenCalled()
  })
})

describe('分页与响应整形', () => {
  it('list_projects 在内存里切页(DC 没有分页版 /project/search)', async () => {
    const projects = Array.from({ length: 7 }, (_unused, index) => ({ id: String(index), key: `P${index}` }))
    mockJira(200, projects)
    const first = await call('list_projects', { limit: 3 })
    await expect(first.json()).resolves.toMatchObject({
      content: {
        projects: [{ id: '0' }, { id: '1' }, { id: '2' }],
        pagination: { nextCursor: '3' },
      },
    })

    vi.unstubAllGlobals()
    mockJira(200, projects)
    const last = await call('list_projects', { limit: 3, cursor: '6' })
    await expect(last.json()).resolves.toMatchObject({
      content: { projects: [{ id: '6' }], pagination: { nextCursor: null } },
    })
  })

  it('search_issues 的 nextCursor 在 startAt+本页 >= total 时给 null', async () => {
    mockJira(200, { issues: [{ id: '1', fields: {} }, { id: '2', fields: {} }], total: 5 })
    await expect((await call('search_issues', { jql: 'x' })).json())
      .resolves.toMatchObject({ content: { pagination: { nextCursor: '2' } } })

    vi.unstubAllGlobals()
    mockJira(200, { issues: [{ id: '1', fields: {} }], total: 1 })
    await expect((await call('search_issues', { jql: 'x' })).json())
      .resolves.toMatchObject({ content: { pagination: { nextCursor: null } } })

    vi.unstubAllGlobals()
    mockJira(200, { issues: [], total: 0 })
    await expect((await call('search_issues', { jql: 'x' })).json())
      .resolves.toMatchObject({ content: { pagination: { nextCursor: null } } })
  })

  it('issue 裁剪出命名字段、保留 fields 与 raw,DC 的 name/key 用户也认得出', async () => {
    mockJira(200, {
      id: '10001',
      key: 'DEV-1',
      self: `${API_BASE}/issue/10001`,
      fields: {
        summary: 'A bug',
        status: { id: '3', name: 'In Progress' },
        issuetype: { id: '1', name: 'Bug' },
        assignee: { name: 'jdoe', displayName: 'J Doe', active: true },
        labels: ['urgent'],
        duedate: '2026-02-01',
      },
    })
    const res = await call('get_issue', { issueIdOrKey: 'DEV-1' })
    const body = (await res.json()) as { content: { issue: Record<string, unknown> } }
    expect(body.content.issue).toMatchObject({
      id: '10001',
      key: 'DEV-1',
      summary: 'A bug',
      status: { id: '3', name: 'In Progress' },
      issueType: { id: '1', name: 'Bug' },
      assignee: { name: 'jdoe', displayName: 'J Doe', active: true },
      labels: ['urgent'],
      dueDate: '2026-02-01',
    })
    expect(body.content.issue.fields).toBeDefined()
    expect(body.content.issue.raw).toBeDefined()
  })
})

describe('校验与错误', () => {
  it('search_issues 的 cursor 在 DC 上必须是非负整数串 → 否则 invalid_argument 且不打上游', async () => {
    const mock = mockJira(200, {})
    const res = await call('search_issues', { jql: 'x', cursor: 'opaque-token' })
    expect(res.status).toBe(400)
    await expect(res.json()).resolves.toMatchObject({
      code: 'invalid_argument',
      message: 'cursor must be a non-negative integer string',
    })
    expect(mock).not.toHaveBeenCalled()
  })

  it('入参校验真的生效:limit 越界 → 400 且不打上游', async () => {
    const mock = mockJira(200, {})
    const res = await call('list_projects', { limit: 1000 })
    expect(res.status).toBe(400)
    expect(((await res.json()) as { code: string }).code).toBe('invalid_argument')
    expect(mock).not.toHaveBeenCalled()
  })

  it('errorMessages[] 拼成一条消息,4xx 归 invalid_argument', async () => {
    mockJira(400, { errorMessages: ['Field is required', 'JQL is invalid'] })
    const res = await call('search_issues', { jql: 'bad' })
    expect(res.status).toBe(400)
    await expect(res.json()).resolves.toMatchObject({
      code: 'invalid_argument',
      message: 'Field is required; JQL is invalid',
    })
  })

  it('errors{} 逐字段拼成 "key: msg"', async () => {
    mockJira(400, { errors: { summary: 'must not be empty', project: 'not found' } })
    await expect((await call('search_issues', { jql: 'x' })).json())
      .resolves.toMatchObject({ message: 'summary: must not be empty; project: not found' })
  })

  it('403 归 permission_denied(不重试)—— 上游把非权限文案的 403 压成可重试的 502,这里不跟', async () => {
    mockJira(403, { message: 'Issue does not exist or you do not have permission to see it.' })
    const res = await call('get_issue', { issueIdOrKey: 'DEV-1' })
    expect(res.status).toBe(403)
    const body = (await res.json()) as { code: string, retryable?: boolean }
    expect(body.code).toBe('permission_denied')
    expect(body.retryable ?? false).toBe(false)
  })

  it('404 保留成 not_found(上游把它压成 400,这里不跟)', async () => {
    mockJira(404, { errorMessages: ['Issue Does Not Exist'] })
    const res = await call('get_issue', { issueIdOrKey: 'NOPE-1' })
    expect(res.status).toBe(404)
    await expect(res.json()).resolves.toMatchObject({ code: 'not_found', message: 'Issue Does Not Exist' })
  })

  it('429 → rate_limited + retryable;5xx → unavailable + retryable', async () => {
    mockJira(429, { message: 'Too many requests' })
    await expect((await call('list_projects', {})).json())
      .resolves.toMatchObject({ code: 'rate_limited', retryable: true })

    vi.unstubAllGlobals()
    mockJira(503, { message: 'Jira is down' })
    await expect((await call('list_projects', {})).json())
      .resolves.toMatchObject({ code: 'unavailable', retryable: true, message: 'Jira is down' })
  })

  it('错误体不是 JSON 时,原文进 message', async () => {
    mockJira(500, '<html>Gateway Error</html>')
    await expect((await call('list_projects', {})).json())
      .resolves.toMatchObject({ message: '<html>Gateway Error</html>' })
  })

  it('该回对象的端点回了数组 → unavailable + retryable', async () => {
    mockJira(200, [1, 2, 3])
    await expect((await call('get_issue', { issueIdOrKey: 'DEV-1' })).json())
      .resolves.toMatchObject({ code: 'unavailable', retryable: true })
  })
})
