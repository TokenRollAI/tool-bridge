import { describe, expect, it, vi } from 'vitest'
import { createProviderHarness } from '../support/providerHarness'
import { createLinearPlugin } from '../../src/linear/index'
import { linearActions } from '../../src/linear/schema'

/**
 * Linear 迁移产物的 wire 级验收。重点在几个"迁移最容易迁丢"的地方:
 * 裸 Authorization 头(**不带 `Bearer `**)、HTTP 200 + `{errors}` 的信封式失败、
 * mutation 后再查一次实体的两趟往返、`assignee_id: "me"` 换 viewer id、
 * 自动翻页的游标循环与上界、以及 `run_query` 的"不抛错、原样透传"。
 */

const API_KEY = 'lin_api_deadbeef'
const plugin = createLinearPlugin()

const {
  call,
  envelope,
  mockJson: mockLinear,
  mockJsonSequence: mockLinearSequence,
  sent,
} = createProviderHarness({
  mountPath: 'pm/linear',
  plugin,
  upstreamAuth: API_KEY,
})

/** 取第 n 次出站请求的 GraphQL body。 */
async function sentBody(mock: ReturnType<typeof vi.fn>, index = 0): Promise<{
  query?: string
  variables?: Record<string, unknown>
}> {
  return (await sent(mock, index).json()) as { query?: string, variables?: Record<string, unknown> }
}

const VIEWER = { id: 'user_me', name: 'Me', displayName: 'me', email: 'me@example.test', active: true }

describe('契约面', () => {
  it('List 出全部 34 个 action,且都带 Zod 派生的 schema', async () => {
    const res = await envelope({ tool: 'List', arguments: {} })
    const tools = (await res.json()) as Array<{ inputSchema?: unknown, name: string, outputSchema?: unknown }>
    expect(tools).toHaveLength(Object.keys(linearActions).length)
    expect(tools).toHaveLength(34)
    for (const tool of tools) {
      expect(tool.inputSchema, `${tool.name} 缺 inputSchema`).toBeDefined()
      expect(tool.outputSchema, `${tool.name} 缺 outputSchema`).toBeDefined()
    }
  })
})

describe('请求拼装', () => {
  it('凭证是裸 Authorization 头:不加 `Bearer ` 前缀(加了 Linear 会 401)', async () => {
    const mock = mockLinear(200, { data: { viewer: VIEWER } })
    await call('get_current_user', {})

    const request = sent(mock)
    expect(request.headers.get('authorization')).toBe(API_KEY)
    expect(request.headers.get('authorization')).not.toContain('Bearer')
  })

  it('34 个 action 都打同一个 GraphQL 端点:POST + query/variables 进 body', async () => {
    const mock = mockLinear(200, { data: { viewer: VIEWER } })
    await call('get_current_user', {})

    const request = sent(mock)
    expect(request.method).toBe('POST')
    expect(request.url).toBe('https://api.linear.app/graphql')
    expect(request.headers.get('content-type')).toBe('application/json')

    const body = await sentBody(mock)
    expect(body.query).toContain('query Viewer')
    // 没有变量时 `variables` 整个键都不该出现(上游 compactObject 的语义)。
    expect(Object.keys(body)).toEqual(['query', 'variables'])
    expect(body.variables).toEqual({})
  })

  it('search_issues 的入参叫 query,GraphQL 变量叫 term —— 名字不能顺手统一', async () => {
    const mock = mockLinear(200, { data: { searchIssues: { nodes: [], pageInfo: {}, totalCount: 0 } } })
    const res = await call('search_issues', { query: 'login bug', first: 10, include_archived: true })

    const body = await sentBody(mock)
    expect(body.variables).toEqual({ term: 'login bug', first: 10, includeArchived: true })
    expect(body.query).toContain('term: $term')
    await expect(res.json()).resolves.toEqual({
      content: { issues: [], page_info: { startCursor: null, endCursor: null, hasPreviousPage: false, hasNextPage: false }, total_count: 0 },
    })
  })

  it('空 filter 发 undefined 而不是 `{}`(后者会被 Linear 当成一个真实且无效的过滤器)', async () => {
    const mock = mockLinear(200, { data: { issues: { nodes: [], pageInfo: {} } } })
    await call('list_linear_issues', { first: 5 })

    const body = await sentBody(mock)
    expect(body.variables).toEqual({ first: 5 })
    expect(body.variables).not.toHaveProperty('filter')
  })

  it('assignee_id: "me" 是字面量:先查 viewer 换成真实 id 再发 filter', async () => {
    const mock = mockLinearSequence([
      { data: { viewer: VIEWER } },
      { data: { issues: { nodes: [], pageInfo: {} } } },
    ])
    await call('list_linear_issues', { assignee_id: 'me', project_id: 'proj_1' })

    expect(mock).toHaveBeenCalledTimes(2)
    expect((await sentBody(mock, 0)).query).toContain('query Viewer')
    expect((await sentBody(mock, 1)).variables).toEqual({
      filter: { project: { id: { eq: 'proj_1' } }, assignee: { id: { eq: 'user_me' } } },
    })
  })

  it('assignee_id 不是 "me" 时不多打一趟 viewer', async () => {
    const mock = mockLinear(200, { data: { issues: { nodes: [], pageInfo: {} } } })
    await call('list_linear_issues', { assignee_id: 'user_other' })

    expect(mock).toHaveBeenCalledTimes(1)
    expect((await sentBody(mock, 0)).variables).toEqual({
      filter: { assignee: { id: { eq: 'user_other' } } },
    })
  })

  it('create_linear_project 不往 create 里发 status_id / state(只有 update 认它们)', async () => {
    const mock = mockLinearSequence([
      { data: { projectCreate: { success: true, project: { id: 'proj_new' } } } },
      { data: { project: { id: 'proj_new', name: 'P', url: 'https://linear.app/p', state: 'planned' } } },
    ])
    const res = await call('create_linear_project', {
      name: 'P',
      team_ids: ['team_1'],
      status_id: 'status_x',
      state: 'started',
      description: 'd',
    })

    const created = (await sentBody(mock, 0)).variables?.input as Record<string, unknown>
    expect(created).toEqual({ name: 'P', teamIds: ['team_1'], description: 'd' })
    expect(created).not.toHaveProperty('statusId')
    expect(created).not.toHaveProperty('state')
    await expect(res.json()).resolves.toEqual({
      content: { id: 'proj_new', name: 'P', url: 'https://linear.app/p', state: 'planned' },
    })
  })

  it('update_linear_project 把 state(状态类型名)换成 statusId —— 多一趟往返', async () => {
    const mock = mockLinearSequence([
      { data: { organization: { projectStatuses: [{ id: 'st_backlog', type: 'backlog' }, { id: 'st_started', type: 'started' }] } } },
      { data: { projectUpdate: { success: true, project: { id: 'proj_1' } } } },
      { data: { project: { id: 'proj_1', name: 'P' } } },
    ])
    await call('update_linear_project', { project_id: 'proj_1', state: 'started' })

    expect(mock).toHaveBeenCalledTimes(3)
    expect((await sentBody(mock, 0)).query).toContain('projectStatuses')
    expect((await sentBody(mock, 1)).variables?.input).toEqual({ statusId: 'st_started' })
  })

  it('显式给了 status_id 就直接用,不再查状态表', async () => {
    const mock = mockLinearSequence([
      { data: { projectUpdate: { success: true, project: { id: 'proj_1' } } } },
      { data: { project: { id: 'proj_1', name: 'P' } } },
    ])
    await call('update_linear_project', { project_id: 'proj_1', status_id: 'st_given', state: 'started' })

    expect(mock).toHaveBeenCalledTimes(2)
    expect((await sentBody(mock, 0)).variables?.input).toEqual({ statusId: 'st_given' })
  })

  it('state 在组织的状态表里找不到 → invalid_argument(不是重试能解决的)', async () => {
    mockLinear(200, { data: { organization: { projectStatuses: [{ id: 'st_backlog', type: 'backlog' }] } } })
    const res = await call('update_linear_project', { project_id: 'proj_1', state: 'nonexistent' })
    expect(res.status).toBe(400)
    await expect(res.json()).resolves.toMatchObject({ code: 'invalid_argument' })
  })
})

describe('mutation 后再查一次实体(一次 action 两趟往返)', () => {
  it('create_linear_issue:先 mutation 拿 id,再查 issue 组出参', async () => {
    const mock = mockLinearSequence([
      { data: { issueCreate: { success: true, issue: { id: 'iss_1' } } } },
      {
        data: {
          issue: {
            id: 'iss_1',
            identifier: 'ENG-1',
            title: 'Fix login',
            description: 'desc',
            url: 'https://linear.app/i/ENG-1',
          },
        },
      },
    ])
    const res = await call('create_linear_issue', { title: 'Fix login', team_id: 'team_1', priority: 2 })

    expect(mock).toHaveBeenCalledTimes(2)
    expect((await sentBody(mock, 0)).variables?.input).toEqual({
      title: 'Fix login',
      teamId: 'team_1',
      priority: 2,
    })
    expect((await sentBody(mock, 1)).variables).toEqual({ id: 'iss_1' })
    await expect(res.json()).resolves.toEqual({
      content: {
        id: 'iss_1',
        identifier: 'ENG-1',
        issue_title: 'Fix login',
        issue_description: 'desc',
        ticket_url: 'https://linear.app/i/ENG-1',
      },
    })
  })

  it('mutation 回 success:false 或拿不到 id → unavailable(入参非法在这之前已被 errors 拦掉)', async () => {
    mockLinear(200, { data: { issueCreate: { success: false } } })
    const res = await call('create_linear_issue', { title: 'x', team_id: 'team_1' })
    await expect(res.json()).resolves.toMatchObject({ code: 'unavailable', retryable: true })
  })

  it('create_comment_reaction 只回 id,不再多查一趟', async () => {
    const mock = mockLinear(200, { data: { reactionCreate: { success: true, reaction: { id: 'react_1' } } } })
    const res = await call('create_comment_reaction', { comment_id: 'c_1', emoji: '+1' })

    expect(mock).toHaveBeenCalledTimes(1)
    await expect(res.json()).resolves.toEqual({
      content: { reaction_id: 'react_1', comment_id: 'c_1', emoji: '+1' },
    })
  })
})

describe('自动翻页', () => {
  it('沿 endCursor 翻完所有页,对外呈现一个完整列表(没有游标出参)', async () => {
    const mock = mockLinearSequence([
      {
        data: {
          teams: {
            nodes: [{ id: 't1', name: 'One', key: 'ONE' }],
            pageInfo: { hasNextPage: true, endCursor: 'cur_1' },
          },
        },
      },
      {
        data: {
          teams: {
            nodes: [{ id: 't2', name: 'Two', key: 'TWO' }],
            pageInfo: { hasNextPage: false, endCursor: null },
          },
        },
      },
    ])
    const res = await call('get_all_linear_teams', {})

    expect(mock).toHaveBeenCalledTimes(2)
    // 第一页不带 after,第二页带上一页的 endCursor。
    expect((await sentBody(mock, 0)).variables).toEqual({})
    expect((await sentBody(mock, 1)).variables).toEqual({ after: 'cur_1' })
    await expect(res.json()).resolves.toEqual({
      content: {
        teams: [{ id: 't1', name: 'One', key: 'ONE' }, { id: 't2', name: 'Two', key: 'TWO' }],
      },
    })
  })

  it('hasNextPage 为 true 但 endCursor 为 null 时停下,不空转', async () => {
    const mock = mockLinear(200, {
      data: { teams: { nodes: [{ id: 't1', name: 'One', key: 'ONE' }], pageInfo: { hasNextPage: true, endCursor: null } } },
    })
    const res = await call('get_all_linear_teams', {})

    expect(mock).toHaveBeenCalledTimes(1)
    await expect(res.json()).resolves.toEqual({ content: { teams: [{ id: 't1', name: 'One', key: 'ONE' }] } })
  })

  it('上游游标不推进时报错而不是静默截断(截断会让调用方拿到一份看起来完整的残缺列表)', async () => {
    // 永远 hasNextPage:true + 同一个 endCursor —— 上游可控的死循环。
    const mock = mockLinear(200, {
      data: { teams: { nodes: [{ id: 't1', name: 'One', key: 'ONE' }], pageInfo: { hasNextPage: true, endCursor: 'stuck' } } },
    })
    const res = await call('get_all_linear_teams', {})

    await expect(res.json()).resolves.toMatchObject({ code: 'unavailable', retryable: true })
    // 撞上界就停,不是无限转下去(网关与插件同进程)。
    expect(mock.mock.calls.length).toBeLessThanOrEqual(100)
    expect(mock.mock.calls.length).toBeGreaterThan(1)
  })
})

describe('GraphQL 信封式错误(HTTP 200 + errors)', () => {
  it('errors 非空即抛,不当成功返回', async () => {
    mockLinear(200, { data: null, errors: [{ message: 'Entity not found: Issue' }] })
    const res = await call('get_linear_issue', { issue_id: 'iss_missing' })

    expect(res.status).toBe(400)
    await expect(res.json()).resolves.toMatchObject({
      code: 'invalid_argument',
      message: 'Entity not found: Issue',
    })
  })

  it('判定顺序有意义:"Invalid authentication" 归 400 而不是 401(照抄上游,别重排)', async () => {
    mockLinear(200, { data: null, errors: [{ message: 'Invalid authentication token' }] })
    const res = await call('get_current_user', {})

    expect(res.status).toBe(400)
    await expect(res.json()).resolves.toMatchObject({ code: 'invalid_argument' })
  })

  it('纯 unauthorized(不含 invalid)才归 401', async () => {
    mockLinear(200, { data: null, errors: [{ message: 'Unauthorized' }] })
    const res = await call('get_current_user', {})

    expect(res.status).toBe(401)
    await expect(res.json()).resolves.toMatchObject({ code: 'permission_denied' })
  })

  it('rate limit 归 rate_limited + retryable;认不出的 GraphQL 错误归 unavailable', async () => {
    mockLinear(200, { data: null, errors: [{ message: 'Rate limit exceeded' }] })
    const limited = await call('get_current_user', {})
    expect(limited.status).toBe(429)
    await expect(limited.json()).resolves.toMatchObject({ code: 'rate_limited', retryable: true })

    vi.unstubAllGlobals()
    mockLinear(200, { data: null, errors: [{ message: 'Something opaque happened' }] })
    await expect((await call('get_current_user', {})).json())
      .resolves.toMatchObject({ code: 'unavailable', retryable: true })
  })

  it('多条 errors 的消息用 "; " 连起来', async () => {
    mockLinear(200, { data: null, errors: [{ message: 'Unauthorized' }, { message: 'again' }] })
    await expect((await call('get_current_user', {})).json())
      .resolves.toMatchObject({ message: 'Unauthorized; again' })
  })

  it('HTTP 200 但没有 data 字段 → unavailable(上游破了契约)', async () => {
    mockLinear(200, {})
    await expect((await call('get_current_user', {})).json())
      .resolves.toMatchObject({ code: 'unavailable', retryable: true })
  })
})

describe('run_query / run_mutation 的透传形态', () => {
  it('不对 GraphQL errors 抛错,把 data/errors/extensions 一起交给调用方', async () => {
    mockLinear(200, {
      data: { viewer: { id: 'u1' } },
      errors: [{ message: 'partial failure' }],
      extensions: { complexity: 3 },
    })
    const res = await call('run_query', { query: '{ viewer { id } }' })

    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toEqual({
      content: {
        data: { viewer: { id: 'u1' } },
        errors: [{ message: 'partial failure' }],
        extensions: { complexity: 3 },
        message: 'partial failure',
      },
    })
  })

  it('没有 errors 时不带 message 键', async () => {
    mockLinear(200, { data: { viewer: { id: 'u1' } } })
    const res = await call('run_query', { query: '{ viewer { id } }' })
    const body = (await res.json()) as { content: Record<string, unknown> }
    expect(body.content).toEqual({ data: { viewer: { id: 'u1' } } })
    expect(body.content).not.toHaveProperty('message')
  })

  it('HTTP 层的错误仍然抛:那时根本没有 GraphQL 响应可透传', async () => {
    mockLinear(401, { message: 'Authentication required' })
    const res = await call('run_query', { query: '{ viewer { id } }' })
    expect(res.status).toBe(401)
    await expect(res.json()).resolves.toMatchObject({
      code: 'permission_denied',
      message: 'Authentication required',
    })
  })

  it('run_mutation 走 mutation 字段,variables 原样带上', async () => {
    const mock = mockLinear(200, { data: { issueDelete: { success: true } } })
    await call('run_mutation', {
      mutation: 'mutation D($id: String!) { issueDelete(id: $id) { success } }',
      variables: { id: 'iss_1' },
    })

    const body = await sentBody(mock)
    expect(body.query).toContain('issueDelete')
    expect(body.variables).toEqual({ id: 'iss_1' })
  })
})

describe('校验与 HTTP 错误', () => {
  it('入参校验真的生效:缺必填的 team_id → 400 且不打上游', async () => {
    const mock = mockLinear(200, {})
    const res = await call('create_linear_issue', { title: 'x' })
    expect(res.status).toBe(400)
    expect(((await res.json()) as { code: string }).code).toBe('invalid_argument')
    expect(mock).not.toHaveBeenCalled()
  })

  it('get_attachment 的两个定位字段都缺 → invalid_argument 且不打上游(跨字段约束,schema 表达不了)', async () => {
    const mock = mockLinear(200, {})
    const res = await call('get_attachment', { issue_id: 'iss_1' })
    expect(res.status).toBe(400)
    await expect(res.json()).resolves.toMatchObject({ code: 'invalid_argument' })
    expect(mock).not.toHaveBeenCalled()
  })

  it('get_attachment 按 file_name 兜底比 URL 末段(去 query)', async () => {
    mockLinear(200, {
      data: {
        issue: {
          attachments: {
            nodes: [
              { id: 'a1', title: 'other', url: 'https://cdn.test/x/nope.pdf' },
              { id: 'a2', title: 'not-matching', url: 'https://cdn.test/y/report.pdf?sig=abc' },
            ],
          },
        },
      },
    })
    const res = await call('get_attachment', { issue_id: 'iss_1', file_name: 'report.pdf' })
    await expect(res.json()).resolves.toMatchObject({
      content: { attachment: { id: 'a2', title: 'not-matching' } },
    })
  })

  it('上游 4xx → invalid_argument,上游 5xx → unavailable + retryable', async () => {
    mockLinear(400, { errors: [{ message: 'Bad request body' }] })
    const bad = await call('get_current_user', {})
    expect(bad.status).toBe(400)
    await expect(bad.json()).resolves.toMatchObject({
      code: 'invalid_argument',
      message: 'Bad request body',
    })

    vi.unstubAllGlobals()
    mockLinear(500, { message: 'Linear is down' })
    const down = await call('get_current_user', {})
    await expect(down.json()).resolves.toMatchObject({
      code: 'unavailable',
      retryable: true,
      message: 'Linear is down',
    })
  })

  it('上游回非 JSON 的网关错误页时,消息用原文而不是崩掉', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(new Response('<html>502 Bad Gateway</html>', {
      status: 502,
      headers: { 'content-type': 'text/html' },
    }))))
    const res = await call('get_current_user', {})
    await expect(res.json()).resolves.toMatchObject({
      code: 'unavailable',
      retryable: true,
      message: '<html>502 Bad Gateway</html>',
    })
  })

  it('传输层失败归一成 unavailable,而不是被抹成 "插件崩了"', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('ECONNREFUSED'))))
    const res = await call('get_current_user', {})
    await expect(res.json()).resolves.toMatchObject({ code: 'unavailable', retryable: true })
    expect(((await (await call('get_current_user', {})).json()) as { message: string }).message)
      .toContain('ECONNREFUSED')
  })

  it('没配 authRef → unavailable 且不打上游', async () => {
    const mock = mockLinear(200, {})
    const res = await call('get_current_user', {}, { auth: null })
    expect(res.status).toBe(503)
    expect(((await res.json()) as { message: string }).message).toContain('authRef')
    expect(mock).not.toHaveBeenCalled()
  })
})

describe('出参整形', () => {
  it('list_issues_by_team_id 的 page_info 是独一份的蛇形键(上游如此,不要顺手统一)', async () => {
    mockLinear(200, {
      data: {
        team: {
          id: 't1',
          name: 'One',
          key: 'ONE',
          issues: { nodes: [], pageInfo: { endCursor: 'cur_9', hasNextPage: true } },
        },
      },
    })
    const res = await call('list_issues_by_team_id', { team_id: 't1' })
    await expect(res.json()).resolves.toEqual({
      content: {
        team: { id: 't1', name: 'One', key: 'ONE' },
        issues: [],
        page_info: { end_cursor: 'cur_9', has_next_page: true },
      },
    })
  })

  it('其余 list 的 page_info 是驼峰键的四字段形状', async () => {
    mockLinear(200, {
      data: { users: { nodes: [VIEWER], pageInfo: { startCursor: 'a', endCursor: 'b', hasPreviousPage: false, hasNextPage: true } } },
    })
    const res = await call('list_linear_users', { first: 1 })
    await expect(res.json()).resolves.toMatchObject({
      content: { page_info: { startCursor: 'a', endCursor: 'b', hasPreviousPage: false, hasNextPage: true } },
    })
  })

  it('未声明的上游字段被裁掉,子实体缺席时是 null 而不是键消失', async () => {
    mockLinear(200, {
      data: {
        cycles: {
          nodes: [{ id: 'c1', name: 'Cycle 1', number: 1, isActive: true, secret_field: 'nope' }],
          pageInfo: { hasNextPage: false },
        },
      },
    })
    const res = await call('list_linear_cycles', {})
    await expect(res.json()).resolves.toEqual({
      content: { cycles: [{ id: 'c1', name: 'Cycle 1', number: 1, isActive: true, team: null }] },
    })
  })

  it('get_linear_project 没要 teams/members/initiatives 时这三个键整个不出现', async () => {
    mockLinear(200, {
      data: { project: { id: 'p1', name: 'P', teams: { nodes: [{ id: 't1' }] } } },
    })
    const res = await call('get_linear_project', { project_id: 'p1' })
    const body = (await res.json()) as { content: { project: Record<string, unknown> } }
    expect(body.content.project).not.toHaveProperty('teams')
    expect(body.content.project).not.toHaveProperty('members')
    expect(body.content.project).not.toHaveProperty('initiatives')
  })

  it('明确要了 include_teams 时才透出,且 @include 指令的变量一起发过去', async () => {
    const mock = mockLinear(200, {
      data: { project: { id: 'p1', name: 'P', teams: { nodes: [{ id: 't1', name: 'One', key: 'ONE' }] } } },
    })
    const res = await call('get_linear_project', { project_id: 'p1', include_teams: true })

    expect((await sentBody(mock)).variables).toEqual({
      id: 'p1',
      includeTeams: true,
      includeMembers: false,
      includeInitiatives: false,
    })
    await expect(res.json()).resolves.toMatchObject({
      content: { project: { teams: { nodes: [{ id: 't1', name: 'One', key: 'ONE' }] } } },
    })
  })

  it('comment 的 reactions 是裸数组而不是 connection —— 不能走 nodes', async () => {
    const mock = mockLinearSequence([
      { data: { commentUpdate: { success: true, comment: { id: 'c1' } } } },
      { data: { comment: { id: 'c1', body: 'edited', reactions: [{ id: 'r1', emoji: '+1' }] } } },
    ])
    const res = await call('update_linear_comment', { comment_id: 'c1', body: 'edited' })

    expect(mock).toHaveBeenCalledTimes(2)
    await expect(res.json()).resolves.toMatchObject({
      content: {
        comment: {
          id: 'c1',
          body: 'edited',
          reactions: [{ id: 'r1', emoji: '+1', user: null, comment: null, issue: null, projectUpdate: null }],
        },
      },
    })
  })
})
