import { describe, expect, it, vi } from 'vitest'
import { z } from 'zod/v4'
import { createProviderHarness } from '../support/providerHarness'
import { createGithubPlugin } from '../../src/github/index'
import { githubActions } from '../../src/github/schema'

/**
 * GitHub 迁移产物(145 action)的 wire 级验收。
 *
 * 145 个 handler 不可能一条条测,故按"迁移最容易迁丢的地方"选点。每个 describe 块对应
 * 一类风险,不是对应一组 action:
 * - 403 身兼限流与权限不足两职,归错码会让 agent 无限重试一堵永远不会开的墙
 * - 三个 action 用**状态码**表达布尔结果(204/404 都是成功),走普通路径会把答案变成错误
 * - `list_repository_issues` 过滤掉 PR 后,`pageInfo.fetched` 是唯一的翻页判据
 * - 搜索 issue/PR 是把十几个结构化入参**编译**成查询语法,不是转发 q
 * - 一批 action 的 schema 全 optional 但上游有必填断言(上游 action 声明漏了 required)
 * - contents 路径要逐段编码但**保留斜杠**,编错就打到别的资源上
 */

const TOKEN = 'github_pat_testdeadbeef'
const plugin = createGithubPlugin()

const {
  call,
  envelope,
  sent,
  sentUrl,
  stubFetch,
} = createProviderHarness({
  mountPath: 'dev/github',
  plugin,
  upstreamAuth: TOKEN,
})

/** 200 + JSON body 的常规上游响应。 */
function mockGithub(status: number, payload: unknown, headers: Record<string, string> = {}) {
  return stubFetch(() => Promise.resolve(new Response(JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  })))
}

/**
 * 无 body 的响应(204/404)。**必须传 `null` 而不是 `''`** —— `new Response('', {status: 204})`
 * 在 undici 下直接 TypeError,那个异常会被归一成 internal 500,看起来像产物的 bug。
 */
function mockStatus(status: number, headers: Record<string, string> = {}) {
  return stubFetch(() => Promise.resolve(new Response(null, { status, headers })))
}

async function sentBody(mock: ReturnType<typeof vi.fn>): Promise<unknown> {
  return JSON.parse(await sent(mock).text())
}

async function content(res: Response): Promise<Record<string, unknown>> {
  return ((await res.json()) as { content: Record<string, unknown> }).content
}

describe('契约面', () => {
  it('~describe 报成单个 tools/v1 export,并带上凭证探针', async () => {
    const res = await createGithubPlugin().fetch(new Request('https://plugin.test/~describe'), {} as never)
    await expect(res.json()).resolves.toEqual({
      protocolVersion: 'plugin/v2',
      exports: [{
        auth: { kind: 'single', required: true },
        id: 'actions',
        profile: 'tools/v1',
        description: 'GitHub',
        credentialProbe: 'get_current_user',
      }],
    })
  })

  it('探针 get_current_user 只读且无必填入参(平台挂载时会空参调它)', () => {
    const spec = githubActions.get_current_user
    expect(spec.effect).toBe('read')
    const schema = z.toJSONSchema(spec.inputSchema, { io: 'input' }) as { required?: string[] }
    expect(schema.required ?? []).toEqual([])
  })

  it('List 出全部 145 个 action,且都带 Zod 派生的 schema', async () => {
    const res = await envelope({ tool: 'List', arguments: {} })
    const tools = (await res.json()) as Array<{ inputSchema?: unknown, name: string, outputSchema?: unknown }>
    expect(tools).toHaveLength(Object.keys(githubActions).length)
    expect(tools).toHaveLength(145)
    for (const tool of tools) {
      expect(tool.inputSchema, `${tool.name} 缺 inputSchema`).toBeDefined()
      expect(tool.outputSchema, `${tool.name} 缺 outputSchema`).toBeDefined()
    }
  })

  it('六组 handler 全都挂上了(每组挑一个点一下,漏整组会在这里暴露)', async () => {
    const res = await envelope({ tool: 'List', arguments: {} })
    const names = new Set(((await res.json()) as { name: string }[]).map(tool => tool.name))
    for (const name of [
      'get_repository', // repository
      'create_issue', // issue
      'merge_pull_request', // pull-request
      'list_releases', // release
      'star_repository', // activity
      'search_repositories', // search
    ]) {
      expect(names.has(name), `缺 ${name}`).toBe(true)
    }
  })
})

describe('请求拼装', () => {
  it('GET:凭证走 authorization Bearer 头,带 API 版本与 User-Agent,无请求体', async () => {
    const mock = mockGithub(200, { id: 1, full_name: 'a/b' })
    await call('get_repository', { owner: 'a', repo: 'b' })

    const request = sent(mock)
    expect(request.method).toBe('GET')
    expect(sentUrl(mock).origin).toBe('https://api.github.com')
    expect(sentUrl(mock).pathname).toBe('/repos/a/b')
    // 凭证在 header,不在 URL —— 部署侧脱敏只需要盯这一个头。
    expect(request.headers.get('authorization')).toBe(`Bearer ${TOKEN}`)
    expect(request.headers.get('accept')).toBe('application/vnd.github+json')
    expect(request.headers.get('x-github-api-version')).toBe('2022-11-28')
    // GitHub REST 缺 User-Agent 直接 403。
    expect(request.headers.get('user-agent')).toBe('tool-bridge')
    // GET 不该带 content-type(没有 body)。
    expect(request.headers.get('content-type')).toBeNull()
    expect(await request.text()).toBe('')
  })

  it('POST:body 是 JSON 且带 content-type,camelCase 入参改名成 snake_case', async () => {
    const mock = mockGithub(201, { number: 7 })
    await call('create_issue', {
      owner: 'a',
      repo: 'b',
      title: 'Bug',
      body: 'broken',
      assignees: ['alice'],
      labels: ['bug'],
      milestone: 3,
    })

    expect(sent(mock).method).toBe('POST')
    expect(sent(mock).headers.get('content-type')).toBe('application/json')
    expect(sentUrl(mock).pathname).toBe('/repos/a/b/issues')
    await expect(sentBody(mock)).resolves.toEqual({
      title: 'Bug',
      body: 'broken',
      assignees: ['alice'],
      labels: ['bug'],
      milestone: 3,
    })
  })

  it('未给的可选参数既不进 query 也不进 body(免得把默认值写死成显式值)', async () => {
    const listed = mockGithub(200, [])
    await call('list_commits', { owner: 'a', repo: 'b' })
    expect([...sentUrl(listed).searchParams.keys()]).toEqual([])

    vi.unstubAllGlobals()
    const created = mockGithub(201, {})
    await call('create_issue', { owner: 'a', repo: 'b', title: 'T' })
    await expect(sentBody(created)).resolves.toEqual({ title: 'T' })
  })

  it('owner/repo 逐个编码,不会拼出跨路径的 URL', async () => {
    const mock = mockGithub(200, {})
    await call('get_repository', { owner: 'a/../etc', repo: 'b c' })
    // `/` 被编码成 %2F,故这仍然是 /repos 下的一个(不存在的)资源,不会逃逸到别的端点。
    expect(sentUrl(mock).pathname).toBe('/repos/a%2F..%2Fetc/b%20c')
  })

  it('DELETE 也能带 JSON body(contents / assignees / reviewers 端点如此设计)', async () => {
    const mock = mockGithub(200, { commit: {} })
    await call('delete_file', { owner: 'a', repo: 'b', path: 'x.txt', message: 'rm', sha: 'abc' })
    expect(sent(mock).method).toBe('DELETE')
    await expect(sentBody(mock)).resolves.toEqual({ message: 'rm', sha: 'abc' })
  })
})

describe('contents 路径编码', () => {
  it('逐段编码但保留段之间的斜杠(整段编码会打到另一个资源上)', async () => {
    const mock = mockGithub(200, [])
    await call('list_directory_contents', { owner: 'a', repo: 'b', path: 'src/deep dir/sub' })
    // 关键:`/` 保留成路径分隔符,空格才被编码。整段 encodeURIComponent 会得到 src%2Fdeep...
    expect(sentUrl(mock).pathname).toBe('/repos/a/b/contents/src/deep%20dir/sub')
  })

  it('首尾多余斜杠与空段被丢掉,空 path 落到仓库根', async () => {
    const trimmed = mockGithub(200, [])
    await call('list_directory_contents', { owner: 'a', repo: 'b', path: '//src//x//' })
    expect(sentUrl(trimmed).pathname).toBe('/repos/a/b/contents/src/x')

    vi.unstubAllGlobals()
    const root = mockGithub(200, [])
    await call('list_directory_contents', { owner: 'a', repo: 'b' })
    expect(sentUrl(root).pathname).toBe('/repos/a/b/contents')
  })

  it('git ref 同样逐段编码;不以 heads/ 或 tags/ 开头当场拒(不打上游)', async () => {
    const ok = mockGithub(200, { ref: 'refs/heads/feat/x' })
    await call('get_ref', { owner: 'a', repo: 'b', ref: 'heads/feat/my branch' })
    expect(sentUrl(ok).pathname).toBe('/repos/a/b/git/ref/heads/feat/my%20branch')

    vi.unstubAllGlobals()
    const rejected = mockGithub(200, {})
    const res = await call('get_ref', { owner: 'a', repo: 'b', ref: 'refs/heads/main' })
    expect(res.status).toBe(400)
    await expect(res.json()).resolves.toMatchObject({ code: 'invalid_argument' })
    // 不打上游:打过去会是个 404 "ref 不存在",比"形状不对"误导人得多。
    expect(rejected).not.toHaveBeenCalled()
  })
})

describe('分页信号(最容易迁丢的一处)', () => {
  it('list_repository_issues:过滤掉 PR,但 pageInfo.fetched 记的是过滤前的原始页长', async () => {
    // 一页 3 条里有 2 条其实是 PR —— 过滤后只剩 1 条 issue。
    mockGithub(200, [
      { number: 1, title: 'real issue' },
      { number: 2, title: 'a PR', pull_request: { url: 'https://api.github.com/...' } },
      { number: 3, title: 'another PR', pull_request: { url: 'https://api.github.com/...' } },
    ])
    const res = await call('list_repository_issues', { owner: 'a', repo: 'b', perPage: 3 })
    expect(await content(res)).toEqual({
      issues: [{ number: 1, title: 'real issue' }],
      // 3 而不是 1:调用方要用它跟自己传的 perPage 比,才知道还有没有下一页。
      pageInfo: { fetched: 3 },
    })
  })

  it('整页都是 PR 时 issues 为空但 fetched 不为 0(否则调用方会在这一页提前停止)', async () => {
    mockGithub(200, [
      { number: 1, pull_request: {} },
      { number: 2, pull_request: {} },
    ])
    const res = await call('list_repository_issues', { owner: 'a', repo: 'b', perPage: 2 })
    expect(await content(res)).toEqual({ issues: [], pageInfo: { fetched: 2 } })
  })

  it('没传 perPage 时按缺省 30 发出 —— fetched 的参照值也是 30', async () => {
    const mock = mockGithub(200, [])
    await call('list_repository_issues', { owner: 'a', repo: 'b' })
    expect(sentUrl(mock).searchParams.get('per_page')).toBe('30')
  })

  it('labels 是逗号分隔的单个参数,不是重复同名参数', async () => {
    const mock = mockGithub(200, [])
    await call('list_repository_issues', { owner: 'a', repo: 'b', labels: ['bug', 'p1'] })
    expect(sentUrl(mock).searchParams.getAll('labels')).toEqual(['bug,p1'])
  })
})

describe('用状态码表达布尔结果的三个 action', () => {
  it('check_repository_starred:204 → starred true,404 → starred false(都是成功)', async () => {
    mockStatus(204)
    const starred = await call('check_repository_starred', { owner: 'a', repo: 'b' })
    expect(starred.status).toBe(200)
    expect(await content(starred)).toEqual({ starred: true })

    vi.unstubAllGlobals()
    mockStatus(404)
    const notStarred = await call('check_repository_starred', { owner: 'a', repo: 'b' })
    // 关键:404 不该冒成 not_found —— "没 star 过"是个正常答案。
    expect(notStarred.status).toBe(200)
    expect(await content(notStarred)).toEqual({ starred: false })
  })

  it('check_pull_request_merged:204/404 同理', async () => {
    mockStatus(204)
    expect(await content(await call('check_pull_request_merged', { owner: 'a', repo: 'b', pullNumber: 1 })))
      .toEqual({ merged: true })

    vi.unstubAllGlobals()
    mockStatus(404)
    expect(await content(await call('check_pull_request_merged', { owner: 'a', repo: 'b', pullNumber: 1 })))
      .toEqual({ merged: false })
  })

  it('这两个 action 的其他错误状态照常冒出来(不是一切都当布尔)', async () => {
    mockGithub(401, { message: 'Bad credentials' })
    const res = await call('check_repository_starred', { owner: 'a', repo: 'b' })
    expect(res.status).toBe(401)
    await expect(res.json()).resolves.toMatchObject({ code: 'permission_denied' })
  })

  it('add_repository_collaborator:204 = 本来就是协作者,201 = 发出了邀请', async () => {
    const already = mockStatus(204)
    const noop = await call('add_repository_collaborator', { owner: 'a', repo: 'b', username: 'alice' })
    expect(await content(noop)).toEqual({ invited: false, invitation: null })
    // body 恒为对象,故 content-type 一直在(与上游一致)。
    expect(sent(already).headers.get('content-type')).toBe('application/json')
    await expect(sentBody(already)).resolves.toEqual({})

    vi.unstubAllGlobals()
    mockGithub(201, { id: 42, permissions: 'push' })
    const invited = await call('add_repository_collaborator', {
      owner: 'a',
      repo: 'b',
      username: 'bob',
      permission: 'push',
    })
    expect(await content(invited)).toEqual({ invited: true, invitation: { id: 42, permissions: 'push' } })
  })
})

describe('403 身兼两职', () => {
  it('配额头归零 → rate_limited + retryable(等一会儿重试有用)', async () => {
    mockGithub(403, { message: 'API rate limit exceeded' }, { 'x-ratelimit-remaining': '0' })
    const res = await call('get_repository', { owner: 'a', repo: 'b' })
    expect(res.status).toBe(429)
    await expect(res.json()).resolves.toMatchObject({
      code: 'rate_limited',
      retryable: true,
      message: 'API rate limit exceeded',
    })
  })

  it('带 retry-after(二级限流)也归 rate_limited', async () => {
    mockGithub(403, { message: 'You have exceeded a secondary rate limit' }, { 'retry-after': '60' })
    expect((await call('get_repository', { owner: 'a', repo: 'b' })).status).toBe(429)
  })

  it('消息里明说了 rate limit,即便没有头也认', async () => {
    mockGithub(403, { message: 'API rate limit exceeded for user' })
    expect((await call('get_repository', { owner: 'a', repo: 'b' })).status).toBe(429)
  })

  it('权限不足 → permission_denied 且**不可**重试(重试一万次也没用)', async () => {
    mockGithub(403, { message: 'Resource not accessible by personal access token' }, {
      'x-ratelimit-remaining': '4999',
    })
    const res = await call('get_repository', { owner: 'a', repo: 'b' })
    expect(res.status).toBe(403)
    const body = (await res.json()) as { code: string, retryable?: boolean }
    expect(body.code).toBe('permission_denied')
    // 这一条是整个 403 处理的要点:归成可重试码会让 agent 撞一堵永远不会开的墙。
    expect(body.retryable ?? false).toBe(false)
  })
})

describe('错误归一', () => {
  it('4xx → 不可重试,5xx → unavailable + retryable', async () => {
    mockGithub(404, { message: 'Not Found' })
    const missing = await call('get_repository', { owner: 'a', repo: 'b' })
    expect(missing.status).toBe(404)
    await expect(missing.json()).resolves.toMatchObject({ code: 'not_found', message: 'Not Found' })

    vi.unstubAllGlobals()
    mockGithub(502, { message: 'Bad gateway' })
    const down = await call('get_repository', { owner: 'a', repo: 'b' })
    expect(down.status).toBe(503)
    await expect(down.json()).resolves.toMatchObject({ code: 'unavailable', retryable: true })
  })

  it('422 的 errors[] 摘进消息 —— 光看 message 只有 "Validation Failed",没法自己改对', async () => {
    mockGithub(422, {
      message: 'Validation Failed',
      errors: [{ field: 'head', code: 'invalid', message: 'No commits between main and feat' }],
    })
    const res = await call('create_pull_request', {
      owner: 'a',
      repo: 'b',
      title: 'T',
      head: 'feat',
      base: 'main',
    })
    expect(res.status).toBe(400)
    const body = (await res.json()) as { code: string, message: string }
    expect(body.code).toBe('invalid_argument')
    expect(body.message).toContain('Validation Failed')
    expect(body.message).toContain('head: No commits between main and feat')
  })

  it('非 JSON 的错误页读成消息,不报"响应不是 JSON"', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(new Response('<html>502 Bad Gateway</html>', {
      status: 502,
      headers: { 'content-type': 'text/html' },
    }))))
    const res = await call('get_repository', { owner: 'a', repo: 'b' })
    expect(res.status).toBe(503)
    await expect(res.json()).resolves.toMatchObject({ code: 'unavailable', retryable: true })
  })

  it('契约说是数组却回了对象 → unavailable + retryable(上游违约,不是调用方的错)', async () => {
    mockGithub(200, { not: 'an array' })
    const res = await call('list_commits', { owner: 'a', repo: 'b' })
    expect(res.status).toBe(503)
    await expect(res.json()).resolves.toMatchObject({ code: 'unavailable', retryable: true })
  })

  it('入参校验真的生效:issueNumber 为 0 → 400 且不打上游', async () => {
    const mock = mockGithub(200, {})
    const res = await call('get_issue', { owner: 'a', repo: 'b', issueNumber: 0 })
    expect(res.status).toBe(400)
    await expect(res.json()).resolves.toMatchObject({ code: 'invalid_argument' })
    expect(mock).not.toHaveBeenCalled()
  })

  it('没配 authRef → 报错且不裸调上游', async () => {
    const mock = mockGithub(200, {})
    const res = await call('get_repository', { owner: 'a', repo: 'b' }, { auth: null })
    expect(res.status).toBe(503)
    expect(((await res.json()) as { message: string }).message).toContain('authRef')
    expect(mock).not.toHaveBeenCalled()
  })
})

describe('schema 全 optional 但上游有必填断言', () => {
  it('create_pull_request_review_comment:缺 owner → invalid_argument,不把 undefined 拼进 URL', async () => {
    const mock = mockGithub(201, {})
    const res = await call('create_pull_request_review_comment', {
      repo: 'b',
      pullNumber: 1,
      body: 'nit',
      commitId: 'abc',
      path: 'x.ts',
    })
    expect(res.status).toBe(400)
    expect(((await res.json()) as { message: string }).message).toContain('owner')
    // 不补断言就会打出 /repos/undefined/b/pulls/1/comments —— 一个查不出原因的 404。
    expect(mock).not.toHaveBeenCalled()
  })

  it('缺 pullNumber / commitId / path 同样当场拒', async () => {
    for (const missing of ['pullNumber', 'commitId', 'path'] as const) {
      vi.unstubAllGlobals()
      const mock = mockGithub(201, {})
      const args: Record<string, unknown> = {
        owner: 'a',
        repo: 'b',
        pullNumber: 1,
        body: 'nit',
        commitId: 'abc',
        path: 'x.ts',
      }
      delete args[missing]
      const res = await call('create_pull_request_review_comment', args)
      expect(res.status, `缺 ${missing} 应当被拒`).toBe(400)
      expect(mock).not.toHaveBeenCalled()
    }
  })

  it('齐了就照常发出', async () => {
    const mock = mockGithub(201, { id: 9 })
    await call('create_pull_request_review_comment', {
      owner: 'a',
      repo: 'b',
      pullNumber: 12,
      body: 'nit',
      commitId: 'abc123',
      path: 'src/x.ts',
      line: 42,
      side: 'RIGHT',
    })
    expect(sentUrl(mock).pathname).toBe('/repos/a/b/pulls/12/comments')
    await expect(sentBody(mock)).resolves.toEqual({
      body: 'nit',
      commit_id: 'abc123',
      path: 'src/x.ts',
      line: 42,
      side: 'RIGHT',
    })
  })

  it('update_label 的 color 在本地校验(GitHub 只回一个看不出错在哪的 422)', async () => {
    const mock = mockGithub(200, {})
    const res = await call('update_label', { owner: 'a', repo: 'b', name: 'bug', color: '#ff0000' })
    expect(res.status).toBe(400)
    expect(((await res.json()) as { message: string }).message).toContain('color')
    expect(mock).not.toHaveBeenCalled()

    vi.unstubAllGlobals()
    const ok = mockGithub(200, { name: 'bug' })
    await call('update_label', { owner: 'a', repo: 'b', name: 'bug', color: 'FF0000' })
    await expect(sentBody(ok)).resolves.toEqual({ color: 'FF0000' })
  })
})

describe('搜索查询编译', () => {
  it('结构化入参编译成 qualifier,自由文本排在最前', async () => {
    const mock = mockGithub(200, { total_count: 0, items: [] })
    await call('search_issues_and_pull_requests', {
      query: 'memory leak',
      owner: 'acme',
      repo: 'api',
      state: 'open',
      type: 'issue',
      author: 'alice',
      isMerged: false,
    })
    expect(sentUrl(mock).pathname).toBe('/search/issues')
    expect(sentUrl(mock).searchParams.get('q'))
      .toBe('memory leak repo:acme/api state:open is:issue author:alice is:unmerged')
  })

  it('带空白的值加引号,否则 qualifier 会在空格处断开', async () => {
    const mock = mockGithub(200, { total_count: 0, items: [] })
    await call('search_issues_and_pull_requests', { label: 'needs triage', assignee: 'bob' })
    // 不加引号的话 `label:needs triage` 里的 triage 会变成自由文本,过滤不生效。
    expect(sentUrl(mock).searchParams.get('q')).toBe('label:"needs triage" assignee:bob')
  })

  it('state: all 表示"不加限定",不发 state qualifier', async () => {
    const mock = mockGithub(200, { total_count: 0, items: [] })
    await call('search_issues_and_pull_requests', { q: 'x', state: 'all' })
    expect(sentUrl(mock).searchParams.get('q')).toBe('x')
  })

  it('isMerged false 要发 is:unmerged,不是"不发"', async () => {
    const merged = mockGithub(200, { total_count: 0, items: [] })
    await call('search_issues_and_pull_requests', { isMerged: true })
    expect(sentUrl(merged).searchParams.get('q')).toBe('is:merged')

    vi.unstubAllGlobals()
    const unmerged = mockGithub(200, { total_count: 0, items: [] })
    await call('search_issues_and_pull_requests', { isMerged: false })
    expect(sentUrl(unmerged).searchParams.get('q')).toBe('is:unmerged')
  })

  it('只给 owner → user:owner;repo 自带斜杠 → 直接当全名用', async () => {
    const userOnly = mockGithub(200, { total_count: 0, items: [] })
    await call('search_issues_and_pull_requests', { owner: 'acme' })
    expect(sentUrl(userOnly).searchParams.get('q')).toBe('user:acme')

    vi.unstubAllGlobals()
    const fullName = mockGithub(200, { total_count: 0, items: [] })
    await call('search_issues_and_pull_requests', { repo: 'acme/api' })
    expect(sentUrl(fullName).searchParams.get('q')).toBe('repo:acme/api')
  })

  it('search_repositories 把命中项叫 repositories,其余五个叫 items(上游既有契约)', async () => {
    mockGithub(200, { total_count: 2, incomplete_results: false, items: [{ id: 1 }, { id: 2 }] })
    const repos = await call('search_repositories', { query: 'zod' })
    expect(await content(repos)).toEqual({
      total_count: 2,
      incomplete_results: false,
      repositories: [{ id: 1 }, { id: 2 }],
    })

    vi.unstubAllGlobals()
    mockGithub(200, { total_count: 1, items: [{ login: 'alice' }] })
    const users = await call('search_users', { query: 'alice' })
    expect(await content(users)).toEqual({
      total_count: 1,
      incomplete_results: false,
      items: [{ login: 'alice' }],
    })
  })
})

describe('内容编解码', () => {
  it('get_file_contents:补 content_base64(去掉折行)与解码后的文本', async () => {
    // GitHub 的 base64 按 60 字符折行,atob 不吃换行。
    mockGithub(200, {
      type: 'file',
      name: 'x.txt',
      path: 'x.txt',
      encoding: 'base64',
      content: 'aGVsbG8g\nd29ybGQ=\n',
    })
    const res = await call('get_file_contents', { owner: 'a', repo: 'b', path: 'x.txt' })
    expect(await content(res)).toMatchObject({
      content_base64: 'aGVsbG8gd29ybGQ=',
      decoded_content: 'hello world',
    })
  })

  it('解不成 UTF-8(二进制文件)时 decoded_content 缺席,而不是 null', async () => {
    // 0xFF 0xFE 不是合法 UTF-8。出参声明写的是 z.string().optional(),null 不在契约里。
    mockGithub(200, { type: 'file', encoding: 'base64', content: '//4=' })
    const res = await call('get_file_contents', { owner: 'a', repo: 'b', path: 'bin' })
    const body = await content(res)
    expect(body.content_base64).toBe('//4=')
    expect('decoded_content' in body).toBe(false)
  })

  it('不透出上游的 content 键(生成的出参声明里没有它,content_base64 才是)', async () => {
    mockGithub(200, { type: 'file', name: 'x.txt', sha: 'abc', encoding: 'base64', content: 'aGk=' })
    const res = await call('get_file_contents', { owner: 'a', repo: 'b', path: 'x.txt' })
    const body = await content(res)
    // content_base64 承载同一份信息(还去掉了折行),故丢掉 content 无损。
    expect('content' in body).toBe(false)
    expect(body).toMatchObject({ sha: 'abc', content_base64: 'aGk=', decoded_content: 'hi' })
  })

  it('目录与文件用同一个端点:拿到另一种形状报 invalid_argument 而不是塞一堆 undefined', async () => {
    mockGithub(200, [{ type: 'file', name: 'a.txt' }])
    const asFile = await call('get_file_contents', { owner: 'a', repo: 'b', path: 'src' })
    expect(asFile.status).toBe(400)
    expect(((await asFile.json()) as { message: string }).message).toContain('目录')

    vi.unstubAllGlobals()
    mockGithub(200, { type: 'file', name: 'a.txt' })
    const asDir = await call('list_directory_contents', { owner: 'a', repo: 'b', path: 'a.txt' })
    expect(asDir.status).toBe(400)
  })

  it('symlink / submodule 也回对象,但没有可读内容,一并挡下', async () => {
    mockGithub(200, { type: 'symlink', target: '../real' })
    const res = await call('get_file_contents', { owner: 'a', repo: 'b', path: 'link' })
    expect(res.status).toBe(400)
  })

  it('写文件:contentBase64 优先(去换行),否则把 content 当 UTF-8 编码', async () => {
    const raw = mockGithub(200, { content: {} })
    await call('create_or_update_file', {
      owner: 'a',
      repo: 'b',
      path: 'x.txt',
      message: 'add',
      content: 'ignored',
      contentBase64: 'aGVsbG8=\n',
    })
    await expect(sentBody(raw)).resolves.toMatchObject({ content: 'aGVsbG8=' })

    vi.unstubAllGlobals()
    const text = mockGithub(200, { content: {} })
    await call('create_or_update_file', {
      owner: 'a',
      repo: 'b',
      path: 'x.txt',
      message: 'add',
      content: 'hello world',
    })
    await expect(sentBody(text)).resolves.toMatchObject({ content: 'aGVsbG8gd29ybGQ=' })
  })
})

describe('空/异常响应体', () => {
  it('空仓库的 contributors 回 204 无 body → 归一成空列表(这是正常状态,不是错误)', async () => {
    mockStatus(204)
    const res = await call('list_repository_contributors', { owner: 'a', repo: 'b' })
    expect(res.status).toBe(200)
    expect(await content(res)).toEqual({ contributors: [] })
  })

  it('期待 204 的写操作:响应体丢弃,返回固定的确认形状', async () => {
    mockStatus(204)
    expect(await content(await call('star_repository', { owner: 'a', repo: 'b' }))).toEqual({ ok: true })

    vi.unstubAllGlobals()
    mockStatus(204)
    expect(await content(await call('lock_issue', { owner: 'a', repo: 'b', issueNumber: 1 })))
      .toEqual({ locked: true })

    vi.unstubAllGlobals()
    mockStatus(204)
    expect(await content(await call('dispatch_workflow', {
      owner: 'a',
      repo: 'b',
      workflowId: 'ci.yml',
      ref: 'main',
    }))).toEqual({ dispatched: true })
  })
})

describe('出参整形', () => {
  it('check/workflow 族是 {total_count, <族名>} 信封,不是裸数组', async () => {
    mockGithub(200, { total_count: 2, check_runs: [{ id: 1 }, { id: 2 }], extra: 'dropped' })
    const runs = await call('list_check_runs_for_ref', { owner: 'a', repo: 'b', ref: 'main' })
    expect(await content(runs)).toEqual({ total_count: 2, check_runs: [{ id: 1 }, { id: 2 }] })

    vi.unstubAllGlobals()
    mockGithub(200, { total_count: 1, workflow_runs: [{ id: 5 }] })
    const wf = await call('list_workflow_runs', { owner: 'a', repo: 'b' })
    expect(await content(wf)).toEqual({ total_count: 1, workflow_runs: [{ id: 5 }] })
  })

  it('total_count 缺失兜底 0,族列表缺失兜底空数组', async () => {
    mockGithub(200, {})
    const res = await call('list_repository_workflows', { owner: 'a', repo: 'b' })
    expect(await content(res)).toEqual({ total_count: 0, workflows: [] })
  })

  it('requested_reviewers 的写端点回的是整个 PR:PR 留在 pull_request 下,两个子列表提到顶层', async () => {
    mockGithub(201, {
      number: 7,
      title: 'PR',
      requested_reviewers: [{ login: 'alice' }],
      requested_teams: [{ slug: 'core' }],
    })
    const res = await call('request_pull_request_reviewers', {
      owner: 'a',
      repo: 'b',
      pullNumber: 7,
      reviewers: ['alice'],
      teamReviewers: ['core'],
    })
    expect(await content(res)).toEqual({
      pull_request: {
        number: 7,
        title: 'PR',
        requested_reviewers: [{ login: 'alice' }],
        requested_teams: [{ slug: 'core' }],
      },
      requested_reviewers: [{ login: 'alice' }],
      requested_teams: [{ slug: 'core' }],
    })
  })

  it('compare_commits 把两个子列表提到顶层,同时留着完整对比对象', async () => {
    mockGithub(200, { status: 'ahead', ahead_by: 2, commits: [{ sha: 'a' }], files: [{ filename: 'x' }] })
    const res = await call('compare_commits', { owner: 'a', repo: 'b', basehead: 'main...feat' })
    expect(await content(res)).toEqual({
      comparison: { status: 'ahead', ahead_by: 2, commits: [{ sha: 'a' }], files: [{ filename: 'x' }] },
      commits: [{ sha: 'a' }],
      files: [{ filename: 'x' }],
    })
  })

  it('generate_release_notes 只透出 name/body,缺失兜底空串', async () => {
    mockGithub(200, { name: 'v1.0', body: '## Changes', extra: 'dropped' })
    const res = await call('generate_release_notes', { owner: 'a', repo: 'b', tagName: 'v1.0' })
    expect(await content(res)).toEqual({ name: 'v1.0', body: '## Changes' })
  })
})

describe('空串语义', () => {
  it('release 的 body 传空串是"清空说明",要发出去而不是当成没给', async () => {
    const mock = mockGithub(200, { id: 1 })
    await call('update_release', { owner: 'a', repo: 'b', releaseId: 1, body: '', name: '' })
    // 空串保留:把它当成 undefined 会出现"想清空却改不动"这种查不出来的 bug。
    await expect(sentBody(mock)).resolves.toEqual({ body: '', name: '' })
  })

  it('tagName 这类"空等于没有"的字段则去空白后丢掉', async () => {
    const mock = mockGithub(200, { id: 1 })
    await call('update_release', { owner: 'a', repo: 'b', releaseId: 1, tagName: '   ' })
    await expect(sentBody(mock)).resolves.toEqual({})
  })

  it('label 的增删走三个不同端点:POST 追加、PUT 替换全集、DELETE 单个返回剩余', async () => {
    const added = mockGithub(200, [{ name: 'bug' }])
    await call('add_issue_labels', { owner: 'a', repo: 'b', issueNumber: 1, labels: ['bug'] })
    expect(sent(added).method).toBe('POST')

    vi.unstubAllGlobals()
    const replaced = mockGithub(200, [])
    await call('set_issue_labels', { owner: 'a', repo: 'b', issueNumber: 1, labels: [] })
    expect(sent(replaced).method).toBe('PUT')
    // 传空数组是"清空"的正规写法,不能被当成"没传"而丢掉。
    await expect(sentBody(replaced)).resolves.toEqual({ labels: [] })

    vi.unstubAllGlobals()
    const removed = mockGithub(200, [{ name: 'p1' }])
    const res = await call('remove_issue_label', { owner: 'a', repo: 'b', issueNumber: 1, label: 'bug' })
    expect(sent(removed).method).toBe('DELETE')
    expect(sentUrl(removed).pathname).toBe('/repos/a/b/issues/1/labels/bug')
    // 摘单个 label 返回**剩下的**列表,不是 204。
    expect(await content(res)).toEqual({ labels: [{ name: 'p1' }] })
  })
})

describe('出参顶层的 content 键不会被误当成 ToolResult 信封', () => {
  /**
   * GitHub 的 reaction 出参里 `content` 是**业务字段**(表情名),不是信封载荷。
   * core 的 `toToolResult` 曾只看"有没有 content 键"就整个透传 —— 那样 id/user/created_at
   * 会降级成 ToolResult 上的野键,而且不报错、不掉测试,调用方只是静默少字段。
   * 判据已改成"键集合不含外来键",这里从 wire 侧钉住它。
   */
  it('create_issue_reaction 的完整对象进 content,而不是只剩表情名', async () => {
    mockGithub(201, {
      id: 99,
      node_id: 'RE_x',
      content: '+1',
      user: { login: 'octocat', id: 1 },
      created_at: '2026-01-01T00:00:00Z',
    })
    const res = await call('create_issue_reaction', {
      owner: 'acme', repo: 'app', issueNumber: 7, content: '+1',
    })
    const body = (await res.json()) as { content?: Record<string, unknown> }
    // content 是信封载荷,里面装着整个 reaction 对象。
    expect(body.content).toMatchObject({ id: 99, content: '+1' })
    expect((body.content as { user?: { login?: string } }).user?.login).toBe('octocat')
  })
})
