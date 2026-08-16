import {
  base64urlEncode,
  type CallContext,
  encodeCallContext,
  HEADER_TB_CONTEXT,
  HEADER_TB_UPSTREAM_AUTH,
} from '@tool-bridge/core'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createDockerHubPlugin } from '../../src/docker_hub/index'
import { dockerHubActions } from '../../src/docker_hub/schema'

/**
 * Docker Hub 迁移产物的 wire 级验收。重点在四处迁移最容易迁丢的地方:
 * `identifier:secret` 换 bearer token 的那一跳、snake_case → camelCase 的响应整形、
 * `get_image` 的客户端分页扫描、以及藏在 `errinfo` 里的错误原因。
 */

const PLUGIN_TOKEN = 'tbp_test'
const ENV = { PLUGIN_TOKEN }
const API_KEY = 'octocat:dckr_pat_secret'
const BEARER = 'hub_bearer_token'
const TOKEN_PATH = '/v2/auth/token'
const plugin = createDockerHubPlugin()

const CALLER: CallContext = {
  keyId: 'k1',
  owner: 'agent:tester',
  scopes: [],
  traceId: 't1',
  mountPath: 'registry/dockerhub',
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

function json(status: number, payload: unknown): Response {
  // 204/205/304 是 null body status:`new Response('', {status:204})` 在 undici 下直接
  // TypeError,而那个异常会被 plugin-sdk 归一成 internal 500 —— 看起来像产物的 bug,
  // 实际是构造响应的这一行。空正文一律传 null。
  const body = payload === null ? null : JSON.stringify(payload)
  return new Response(body, {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

/**
 * 换 token 那一跳自动应答;业务响应按给定顺序出队(`get_image` 会连打好几页)。
 * 队列空了就回 `{}`,免得少给一页时炸在难懂的地方。
 */
function mockHub(...business: Array<[number, unknown]>): ReturnType<typeof vi.fn> {
  const queue = [...business]
  const fn = vi.fn((request: Request) => {
    if (new URL(request.url).pathname === TOKEN_PATH) {
      return Promise.resolve(json(200, { access_token: BEARER }))
    }
    const [status, payload] = queue.shift() ?? [200, {}]
    return Promise.resolve(json(status, payload))
  })
  vi.stubGlobal('fetch', fn)
  return fn
}

/** 换 token 这一跳本身失败。 */
function mockTokenFailure(status: number, payload: unknown): ReturnType<typeof vi.fn> {
  const fn = vi.fn(() => Promise.resolve(json(status, payload)))
  vi.stubGlobal('fetch', fn)
  return fn
}

function requests(mock: ReturnType<typeof vi.fn>): Request[] {
  return mock.mock.calls.map(args => (args as [Request])[0])
}

/** 换完 token 之后打的第一个业务请求。 */
function business(mock: ReturnType<typeof vi.fn>): Request {
  const request = requests(mock).find(item => new URL(item.url).pathname !== TOKEN_PATH)
  if (request === undefined) throw new Error('没有打出任何业务请求')
  return request
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('契约面', () => {
  it('~describe 报单个 tools/v1 export(没有 credentialProbe:read action 都要业务 id)', async () => {
    const res = await plugin.fetch(new Request('https://plugin.test/~describe'), ENV as never)
    await expect(res.json()).resolves.toEqual({
      protocolVersion: 'plugin/v2',
      exports: [{
        auth: { kind: 'single', required: true },
        id: 'actions',
        profile: 'tools/v1',
        description: 'Docker Hub',
      }],
    })
  })

  it('List 出全部 14 个 action,且都带 Zod 派生的 schema', async () => {
    const res = await envelope({ tool: 'List', arguments: {} })
    const tools = (await res.json()) as Array<{ inputSchema?: unknown, name: string, outputSchema?: unknown }>
    expect(tools).toHaveLength(Object.keys(dockerHubActions).length)
    expect(tools).toHaveLength(14)
    for (const tool of tools) {
      expect(tool.inputSchema, `${tool.name} 缺 inputSchema`).toBeDefined()
      expect(tool.outputSchema, `${tool.name} 缺 outputSchema`).toBeDefined()
    }
  })

  it('删除类 action 的 effect 是 destructive', async () => {
    const res = await envelope({ tool: 'List', arguments: {} })
    const tools = (await res.json()) as Array<{ effect?: string, name: string }>
    const effectOf = (name: string): string | undefined => tools.find(tool => tool.name === name)?.effect
    expect(effectOf('delete_team')).toBe('destructive')
    expect(effectOf('remove_org_member')).toBe('destructive')
    expect(effectOf('remove_team_member')).toBe('destructive')
  })
})

describe('凭证与换取令牌', () => {
  it('先 POST /v2/auth/token 换 bearer,再拿它打业务接口', async () => {
    const mock = mockHub([200, { count: 0, next: null, previous: null, results: [] }])
    await call('list_repositories', { namespace: 'library' })

    const [tokenRequest, apiRequest] = requests(mock)
    expect(tokenRequest?.method).toBe('POST')
    expect(tokenRequest?.url).toBe(`https://hub.docker.com${TOKEN_PATH}`)
    expect(tokenRequest?.headers.get('content-type')).toBe('application/json')
    // 凭证只在这一跳里出现,不会跟着业务请求走。
    await expect(tokenRequest?.json()).resolves.toEqual({ identifier: 'octocat', secret: 'dckr_pat_secret' })

    expect(apiRequest?.headers.get('authorization')).toBe(`Bearer ${BEARER}`)
    expect(new URL(apiRequest!.url).pathname).toBe('/v2/namespaces/library/repositories')
  })

  it('secret 里含冒号时只按第一个冒号切', async () => {
    const mock = mockHub([200, { count: 0, next: null, previous: null, results: [] }])
    await envelope(
      { tool: 'Call', arguments: { name: 'list_repositories', args: { namespace: 'library' } } },
      { auth: 'acme-org:oat:with:colons' },
    )
    await expect(requests(mock)[0]?.json()).resolves.toEqual({
      identifier: 'acme-org',
      secret: 'oat:with:colons',
    })
  })

  it.each([
    ['没有冒号', 'justatoken'],
    ['缺 identifier', ':secret-only'],
    ['缺 secret', 'octocat:'],
  ])('凭证格式不对(%s)→ invalid_argument 且不打上游', async (_label, auth) => {
    const mock = mockHub()
    const res = await envelope(
      { tool: 'Call', arguments: { name: 'get_team', args: { orgName: 'acme', teamName: 'core' } } },
      { auth },
    )
    expect(res.status).toBe(400)
    await expect(res.json()).resolves.toMatchObject({ code: 'invalid_argument' })
    expect(mock).not.toHaveBeenCalled()
  })

  it('换取令牌失败按状态归一;响应里没有 access_token → unavailable', async () => {
    mockTokenFailure(401, { detail: 'incorrect authentication credentials' })
    const rejected = await call('get_team', { orgName: 'acme', teamName: 'core' })
    expect(rejected.status).toBe(401)
    await expect(rejected.json()).resolves.toMatchObject({
      code: 'permission_denied',
      message: 'incorrect authentication credentials',
    })

    vi.unstubAllGlobals()
    mockTokenFailure(200, { token: 'wrong field name' })
    await expect((await call('get_team', { orgName: 'acme', teamName: 'core' })).json())
      .resolves.toMatchObject({ code: 'unavailable', retryable: true })
  })

  it('没配 authRef → unavailable 且不打上游', async () => {
    const mock = mockHub()
    const res = await call('list_teams', { orgName: 'acme' }, { auth: null })
    expect(res.status).toBe(503)
    expect(((await res.json()) as { message: string }).message).toContain('authRef')
    expect(mock).not.toHaveBeenCalled()
  })
})

describe('请求拼装', () => {
  it('list_repositories:pageSize 映射成 page_size,未给的筛选项不进 query', async () => {
    const mock = mockHub([200, { count: 0, next: null, previous: null, results: [] }])
    await call('list_repositories', { namespace: 'library', page: 2, pageSize: 50, ordering: '-pull_count' })
    const url = new URL(business(mock).url)
    expect(url.pathname).toBe('/v2/namespaces/library/repositories')
    expect(Object.fromEntries(url.searchParams)).toEqual({
      page: '2',
      page_size: '50',
      ordering: '-pull_count',
    })
  })

  it('路径参数逐段转义(namespace / repository / tag 都可能带斜杠)', async () => {
    const mock = mockHub([200, { name: 'v1' }])
    await call('get_tag', { namespace: 'my org', repository: 'web/app', tag: 'v1.0+build' })
    expect(new URL(business(mock).url).pathname)
      .toBe('/v2/namespaces/my%20org/repositories/web%2Fapp/tags/v1.0%2Bbuild')
  })

  it('create_repository:驼峰入参映成 snake_case 请求体', async () => {
    const mock = mockHub([201, { name: 'app', namespace: 'acme' }])
    await call('create_repository', {
      namespace: 'acme',
      name: 'app',
      description: '短描述',
      fullDescription: '长描述',
      isPrivate: true,
    })
    const request = business(mock)
    expect(request.method).toBe('POST')
    await expect(request.json()).resolves.toEqual({
      namespace: 'acme',
      name: 'app',
      description: '短描述',
      full_description: '长描述',
      is_private: true,
    })
  })

  it('add_org_member:单人邀请也要包成数组走批量接口', async () => {
    const mock = mockHub([200, { invitees: [] }])
    await call('add_org_member', { orgName: 'acme', invitee: 'someone@example.com', teamName: 'core', dryRun: true })
    const request = business(mock)
    expect(new URL(request.url).pathname).toBe('/v2/invites/bulk')
    await expect(request.json()).resolves.toEqual({
      org: 'acme',
      team: 'core',
      invitees: ['someone@example.com'],
      dry_run: true,
    })
  })

  it('删除类 action 用 DELETE,不回正文也算成功', async () => {
    const team = mockHub([204, null])
    const deleted = await call('delete_team', { orgName: 'acme', teamName: 'core' })
    expect(business(team).method).toBe('DELETE')
    expect(new URL(business(team).url).pathname).toBe('/v2/orgs/acme/groups/core')
    await expect(deleted.json()).resolves.toEqual({ content: { deleted: true } })

    vi.unstubAllGlobals()
    const member = mockHub([204, null])
    const removed = await call('remove_team_member', { orgName: 'acme', teamName: 'core', username: 'bob' })
    expect(new URL(business(member).url).pathname).toBe('/v2/orgs/acme/groups/core/members/bob')
    await expect(removed.json()).resolves.toEqual({ content: { removed: true } })
  })
})

describe('响应整形', () => {
  it('仓库摘要:snake_case 映成 camelCase,缺席字段按声明补默认值', async () => {
    mockHub([200, {
      count: 1,
      next: 'https://hub.docker.com/next',
      previous: null,
      results: [{
        name: 'nginx',
        namespace: 'library',
        repository_type: 'image',
        status: 1,
        status_description: 'active',
        is_private: false,
        star_count: 20000,
        pull_count: 1000000,
        last_updated: '2024-05-01T00:00:00Z',
        media_types: ['application/vnd.oci.image.index.v1+json'],
        categories: [{ name: 'Web Servers', slug: 'web-servers' }],
      }],
    }])

    await expect((await call('list_repositories', { namespace: 'library' })).json()).resolves.toEqual({
      content: {
        count: 1,
        next: 'https://hub.docker.com/next',
        previous: null,
        results: [{
          name: 'nginx',
          namespace: 'library',
          repositoryType: 'image',
          status: 1,
          statusDescription: 'active',
          description: null,
          isPrivate: false,
          starCount: 20000,
          pullCount: 1000000,
          lastUpdated: '2024-05-01T00:00:00Z',
          lastModified: null,
          dateRegistered: null,
          affiliation: null,
          mediaTypes: ['application/vnd.oci.image.index.v1+json'],
          contentTypes: [],
          categories: [{ name: 'Web Servers', slug: 'web-servers' }],
          storageSize: null,
        }],
      },
    })
  })

  it('仓库详情多出 permissions / immutableTagsSettings,缺席时是 null 而不是空对象', async () => {
    mockHub([200, {
      name: 'app',
      namespace: 'acme',
      full_description: '长描述',
      has_starred: false,
      permissions: { read: true, write: true },
    }])
    const body = (await (await call('get_repository', { namespace: 'acme', repository: 'app' })).json()) as {
      content: { repository: Record<string, unknown> }
    }
    expect(body.content.repository).toMatchObject({
      fullDescription: '长描述',
      hasStarred: false,
      permissions: { read: true, write: true, admin: false },
      immutableTagsSettings: null,
      collaboratorCount: null,
      source: null,
    })
  })

  it('tag 的 images 既可能是数组也可能是单个对象,统一成数组', async () => {
    mockHub([200, {
      name: 'latest',
      full_size: 12345,
      images: { architecture: 'amd64', digest: 'sha256:aaa', os: 'linux' },
    }])
    const body = (await (await call('get_tag', {
      namespace: 'library',
      repository: 'nginx',
      tag: 'latest',
    })).json()) as { content: { tag: { images: unknown[] } } }
    expect(body.content.tag.images).toHaveLength(1)
    expect(body.content.tag.images[0]).toMatchObject({ architecture: 'amd64', digest: 'sha256:aaa', layers: [] })
  })

  it('list_org_access_tokens 的分页字段是 total 而不是 count;resources 不是数组时整个键不出现', async () => {
    mockHub([200, {
      total: 2,
      next: null,
      previous: null,
      results: [
        { id: 'tok_1', label: 'ci', is_active: true, resources: [{ type: 'repo', path: 'acme/*', scopes: ['read'] }] },
        { id: 'tok_2', label: 'local', is_active: false },
      ],
    }])
    const body = (await (await call('list_org_access_tokens', { orgName: 'acme' })).json()) as {
      content: { results: Array<Record<string, unknown>>, total: number }
    }
    expect(body.content.total).toBe(2)
    expect(body.content.results[0]).toMatchObject({
      id: 'tok_1',
      isActive: true,
      resources: [{ type: 'repo', path: 'acme/*', scopes: ['read'] }],
    })
    expect(body.content.results[1]).not.toHaveProperty('resources')
  })

  it('批量邀请的结果可能多包一层 invitees.invitees,两种形状都要认', async () => {
    const nested = mockHub([200, {
      invitees: { invitees: [{ invitee: 'a@example.com', status: 'created', invite: { id: 'i1', org: 'acme' } }] },
    }])
    await expect((await call('add_org_member', { orgName: 'acme', invitee: 'a@example.com' })).json())
      .resolves.toEqual({
        content: {
          invitees: [{
            invitee: 'a@example.com',
            status: 'created',
            invite: {
              id: 'i1',
              inviterUsername: null,
              invitee: null,
              org: 'acme',
              team: null,
              createdAt: null,
            },
          }],
        },
      })
    expect(nested).toHaveBeenCalledTimes(2)

    vi.unstubAllGlobals()
    mockHub([200, { invitees: [{ invitee: 'b@example.com', status: 'created' }] }])
    const flat = (await (await call('add_org_member', { orgName: 'acme', invitee: 'b@example.com' })).json()) as {
      content: { invitees: Array<{ invite: unknown, invitee: string }> }
    }
    expect(flat.content.invitees[0]).toMatchObject({ invitee: 'b@example.com', invite: null })
  })

  it('成员列表被上游多包一层数组时,取第一项当作那一页', async () => {
    mockHub([200, [{ count: 1, next: null, previous: null, results: [{ username: 'bob', role: 'member' }] }]])
    const body = (await (await call('list_org_members', { orgName: 'acme' })).json()) as {
      content: { count: number, results: Array<{ username: string }> }
    }
    expect(body.content.count).toBe(1)
    expect(body.content.results[0]?.username).toBe('bob')
  })
})

describe('get_image 的客户端分页扫描', () => {
  function tagPage(next: string | null, tags: unknown[]): [number, unknown] {
    return [200, { count: tags.length, next, previous: null, results: tags }]
  }

  it('翻页直到命中 digest,命中即停(不多翻一页)', async () => {
    const mock = mockHub(
      tagPage('https://hub.docker.com/p2', [{ name: 'v1', images: [{ digest: 'sha256:aaa' }] }]),
      tagPage(null, [{ name: 'v2', images: [{ digest: 'sha256:bbb', architecture: 'arm64' }] }]),
      tagPage(null, [{ name: 'v3', images: [] }]),
    )
    const res = await call('get_image', { namespace: 'acme', repository: 'app', digest: 'sha256:bbb' })
    const body = (await res.json()) as { content: { image: { architecture: string }, tag: { name: string } } }
    expect(body.content.tag.name).toBe('v2')
    expect(body.content.image.architecture).toBe('arm64')

    // 每次业务调用都要先换一次 token:两页 = 2 次换 + 2 次业务。
    const pages = requests(mock).filter(item => new URL(item.url).pathname !== TOKEN_PATH)
    expect(pages).toHaveLength(2)
    expect(new URL(pages[0]!.url).searchParams.get('page')).toBe('1')
    expect(new URL(pages[1]!.url).searchParams.get('page')).toBe('2')
    expect(new URL(pages[0]!.url).searchParams.get('page_size')).toBe('25')
  })

  it('翻到最后一页仍未命中 → not_found,消息里带上 digest', async () => {
    mockHub(tagPage(null, [{ name: 'v1', images: [{ digest: 'sha256:aaa' }] }]))
    const res = await call('get_image', { namespace: 'acme', repository: 'app', digest: 'sha256:zzz' })
    expect(res.status).toBe(404)
    await expect(res.json()).resolves.toMatchObject({ code: 'not_found', message: expect.stringContaining('sha256:zzz') })
  })

  it('maxPages 是扫描上限:到顶就停,不会无限翻下去', async () => {
    const mock = mockHub(
      tagPage('https://hub.docker.com/p2', [{ name: 'v1', images: [] }]),
      tagPage('https://hub.docker.com/p3', [{ name: 'v2', images: [] }]),
      tagPage('https://hub.docker.com/p4', [{ name: 'v3', images: [] }]),
    )
    const res = await call('get_image', {
      namespace: 'acme',
      repository: 'app',
      digest: 'sha256:zzz',
      maxPages: 2,
      pageSize: 10,
    })
    expect(res.status).toBe(404)
    const pages = requests(mock).filter(item => new URL(item.url).pathname !== TOKEN_PATH)
    expect(pages).toHaveLength(2)
    expect(new URL(pages[0]!.url).searchParams.get('page_size')).toBe('10')
  })
})

describe('校验与错误', () => {
  it('入参校验真的生效:pageSize 越界 → invalid_argument 且不打上游', async () => {
    const mock = mockHub()
    const res = await call('list_teams', { orgName: 'acme', pageSize: 500 })
    expect(res.status).toBe(400)
    expect(((await res.json()) as { code: string }).code).toBe('invalid_argument')
    expect(mock).not.toHaveBeenCalled()
  })

  it('错误原因藏在 errinfo 里时也要拆出来(既不在 message 也不在 detail)', async () => {
    mockHub([400, { errinfo: { name: ['repository name is already in use'] } }])
    const res = await call('create_repository', { namespace: 'acme', name: 'app' })
    expect(res.status).toBe(400)
    await expect(res.json()).resolves.toMatchObject({
      code: 'invalid_argument',
      message: 'repository name is already in use',
    })
  })

  it('上游 404 → not_found,429 → rate_limited,5xx → unavailable + retryable', async () => {
    mockHub([404, { message: 'object not found' }])
    const missing = await call('get_team', { orgName: 'acme', teamName: 'nope' })
    expect(missing.status).toBe(404)
    await expect(missing.json()).resolves.toMatchObject({ code: 'not_found', message: 'object not found' })

    vi.unstubAllGlobals()
    mockHub([429, { message: 'too many requests' }])
    await expect((await call('get_team', { orgName: 'acme', teamName: 'core' })).json())
      .resolves.toMatchObject({ code: 'rate_limited', retryable: true })

    vi.unstubAllGlobals()
    mockHub([503, { message: 'service unavailable' }])
    await expect((await call('get_team', { orgName: 'acme', teamName: 'core' })).json())
      .resolves.toMatchObject({ code: 'unavailable', retryable: true })
  })

  it('上游回的不是对象 → unavailable + retryable(是上游的问题,不是调用方的)', async () => {
    mockHub([200, 'plain text body'])
    await expect((await call('get_team', { orgName: 'acme', teamName: 'core' })).json())
      .resolves.toMatchObject({ code: 'unavailable', retryable: true })
  })
})
