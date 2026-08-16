import {
  base64urlEncode,
  type CallContext,
  encodeCallContext,
  HEADER_TB_CONTEXT,
  HEADER_TB_UPSTREAM_AUTH,
} from '@tool-bridge/core'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod/v4'
import { createVercelPlugin } from '../../src/vercel/index'
import { vercelActions } from '../../src/vercel/schema'

/**
 * Vercel 迁移产物的 wire 级验收。重点钉住几处"迁移最容易迁丢"的地方:
 * **每个 action 各自的 API 版本号**(同一资源不同动作版本都不一样)、`{user:{…}}` 包装的
 * 双形态、两种布尔 query 编码(1/0 与 true/false)、`sensitive` + `development` 的本地拒绝、
 * 以及出参裁剪时 null 与"字段缺席"之别。
 */

const PLUGIN_TOKEN = 'tbp_test'
const ENV = { PLUGIN_TOKEN }
const API_KEY = 'vercel_test_token'
const plugin = createVercelPlugin()

const CALLER: CallContext = {
  keyId: 'k1',
  owner: 'agent:tester',
  scopes: [],
  traceId: 't1',
  mountPath: 'dev/vercel',
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

function mockVercel(status: number, payload: unknown): ReturnType<typeof vi.fn> {
  const fn = vi.fn(() => Promise.resolve(new Response(JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json' },
  })))
  vi.stubGlobal('fetch', fn)
  return fn
}

function sent(mock: ReturnType<typeof vi.fn>): Request {
  return (mock.mock.calls[0] as [Request])[0]
}

/** 满足出参契约的最小项目对象。 */
const PROJECT = { id: 'prj_1', name: 'web' }
/** 满足出参契约的最小部署对象。 */
const DEPLOYMENT = { id: 'dpl_1' }
/** 满足出参契约的最小环境变量对象。 */
const ENV_VAR = { id: 'env_1', key: 'API_URL', type: 'plain' }

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('契约面', () => {
  it('List 出全部 23 个 action,且都带 Zod 派生的 schema', async () => {
    const res = await envelope({ tool: 'List', arguments: {} })
    const tools = (await res.json()) as Array<{ inputSchema?: unknown, name: string, outputSchema?: unknown }>
    expect(tools).toHaveLength(Object.keys(vercelActions).length)
    expect(tools).toHaveLength(23)
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
        description: 'Vercel',
        credentialProbe: 'get_auth_user',
      }],
    })
  })

  it('探针指向的工具确实存在、只读、且无必填入参(平台挂载时会空参调它)', () => {
    const spec = vercelActions.get_auth_user
    expect(spec.effect).toBe('read')
    const schema = z.toJSONSchema(spec.inputSchema, { io: 'input' }) as { required?: string[] }
    expect(schema.required ?? []).toEqual([])
  })

  it('删除类 action 的 effect 是 destructive(平台按它决定要不要二次确认)', () => {
    expect(vercelActions.delete_project_env.effect).toBe('destructive')
  })
})

describe('每个 action 各自的 API 版本号(最容易统一错的地方)', () => {
  it.each([
    ['get_auth_user', {}, 'GET', '/v2/user'],
    ['list_teams', {}, 'GET', '/v2/teams'],
    ['get_team', { teamId: 'team_1' }, 'GET', '/v2/teams/team_1'],
    ['list_projects', {}, 'GET', '/v10/projects'],
    ['get_project', { idOrName: 'web' }, 'GET', '/v9/projects/web'],
    ['create_project', { name: 'web' }, 'POST', '/v11/projects'],
    ['update_project', { idOrName: 'web' }, 'PATCH', '/v9/projects/web'],
    ['list_deployments', {}, 'GET', '/v6/deployments'],
    ['get_deployment', { idOrUrl: 'dpl_1' }, 'GET', '/v13/deployments/dpl_1'],
    ['get_deployment_events', { idOrUrl: 'dpl_1' }, 'GET', '/v3/deployments/dpl_1/events'],
    ['get_runtime_logs', { projectId: 'prj_1', deploymentId: 'dpl_1' }, 'GET',
      '/v1/projects/prj_1/deployments/dpl_1/runtime-logs'],
    ['list_project_envs', { idOrName: 'web' }, 'GET', '/v10/projects/web/env'],
    ['delete_project_env', { idOrName: 'web', id: 'env_1' }, 'DELETE', '/v9/projects/web/env/env_1'],
    ['list_project_domains', { idOrName: 'web' }, 'GET', '/v9/projects/web/domains'],
    ['get_project_domain', { idOrName: 'web', domain: 'a.com' }, 'GET', '/v9/projects/web/domains/a.com'],
    ['add_project_domain', { idOrName: 'web', name: 'a.com' }, 'POST', '/v10/projects/web/domains'],
    ['verify_project_domain', { idOrName: 'web', domain: 'a.com' }, 'POST',
      '/v9/projects/web/domains/a.com/verify'],
    ['get_domain_config', { domain: 'a.com' }, 'GET', '/v6/domains/a.com/config'],
    ['list_webhooks', {}, 'GET', '/v1/webhooks'],
    ['get_webhook', { id: 'hook_1' }, 'GET', '/v1/webhooks/hook_1'],
  ])('%s → %s %s', async (name, args, method, path) => {
    // 一个"什么都满足"的响应体:各 action 只取自己要的字段。
    const mock = mockVercel(200, {
      id: 'x_1',
      name: 'a.com',
      url: 'https://hooks.example/x',
      key: 'K',
      type: 'plain',
      user: { id: 'usr_1' },
      team: { id: 'team_1' },
    })
    await call(name, args)
    const request = sent(mock)
    expect(request.method).toBe(method)
    expect(new URL(request.url).pathname).toBe(path)
    expect(new URL(request.url).origin).toBe('https://api.vercel.com')
    expect(request.headers.get('authorization')).toBe(`Bearer ${API_KEY}`)
  })

  it('create_project_env 用 v10、update_project_env 用 v9(同一资源两个版本)', async () => {
    const created = mockVercel(200, { envs: [ENV_VAR] })
    await call('create_project_env', {
      idOrName: 'web',
      key: 'API_URL',
      value: 'https://x',
      type: 'plain',
      target: ['production'],
    })
    expect(new URL(sent(created).url).pathname).toBe('/v10/projects/web/env')
    expect(sent(created).method).toBe('POST')

    vi.unstubAllGlobals()
    const updated = mockVercel(200, ENV_VAR)
    await call('update_project_env', {
      idOrName: 'web',
      id: 'env_1',
      key: 'API_URL',
      value: 'https://y',
      type: 'plain',
      target: ['production'],
    })
    expect(new URL(sent(updated).url).pathname).toBe('/v9/projects/web/env/env_1')
    expect(sent(updated).method).toBe('PATCH')
  })

  it('路径段被 URL 编码(项目名 / 域名可能带特殊字符)', async () => {
    const mock = mockVercel(200, PROJECT)
    await call('get_project', { idOrName: 'my org/web' })
    expect(new URL(sent(mock).url).pathname).toBe('/v9/projects/my%20org%2Fweb')
  })
})

describe('请求拼装', () => {
  it('两种布尔 query 编码并存:builds 发 1/0,withGitRepoInfo 发 true/false', async () => {
    const events = mockVercel(200, [])
    await call('get_deployment_events', { idOrUrl: 'dpl_1', builds: true, direction: 'backward', limit: 10 })
    expect(Object.fromEntries(new URL(sent(events).url).searchParams)).toEqual({
      builds: '1',
      direction: 'backward',
      limit: '10',
    })

    vi.unstubAllGlobals()
    const off = mockVercel(200, [])
    await call('get_deployment_events', { idOrUrl: 'dpl_1', builds: false })
    expect(new URL(sent(off).url).searchParams.get('builds')).toBe('0')

    vi.unstubAllGlobals()
    const deployment = mockVercel(200, DEPLOYMENT)
    await call('get_deployment', { idOrUrl: 'dpl_1', withGitRepoInfo: true })
    expect(new URL(sent(deployment).url).searchParams.get('withGitRepoInfo')).toBe('true')
  })

  it('未给的可选 query 不出现(免得把默认值写死成显式值)', async () => {
    const mock = mockVercel(200, { projects: [] })
    await call('list_projects', { limit: 20 })
    expect([...new URL(sent(mock).url).searchParams.keys()]).toEqual(['limit'])
  })

  it('create_project:body 只带给了的字段,布尔 false 要留住', async () => {
    const mock = mockVercel(200, PROJECT)
    await call('create_project', {
      name: 'web',
      framework: 'nextjs',
      gitForkProtection: false,
      directoryListing: true,
    })
    const request = sent(mock)
    expect(request.headers.get('content-type')).toBe('application/json')
    await expect(request.json()).resolves.toEqual({
      name: 'web',
      framework: 'nextjs',
      gitForkProtection: false,
      directoryListing: true,
    })
  })

  it('update_project:idOrName 只进路径,不进 body', async () => {
    const mock = mockVercel(200, PROJECT)
    await call('update_project', { idOrName: 'web', name: 'web-2' })
    await expect(sent(mock).json()).resolves.toEqual({ name: 'web-2' })
  })

  it('verify_project_domain 是不带 body 的 POST,因此也不带 content-type', async () => {
    const mock = mockVercel(200, { name: 'a.com', verified: true })
    await call('verify_project_domain', { idOrName: 'web', domain: 'a.com' })
    const request = sent(mock)
    expect(request.method).toBe('POST')
    expect(request.headers.get('content-type')).toBeNull()
    expect(await request.text()).toBe('')
  })

  it('create_webhook:数组字段原样进 body', async () => {
    const mock = mockVercel(200, { id: 'hook_1', url: 'https://hooks.example/x' })
    await call('create_webhook', {
      url: 'https://hooks.example/x',
      events: ['deployment.created'],
      projectIds: ['prj_1', 'prj_2'],
    })
    await expect(sent(mock).json()).resolves.toEqual({
      url: 'https://hooks.example/x',
      events: ['deployment.created'],
      projectIds: ['prj_1', 'prj_2'],
    })
  })
})

describe('响应整形', () => {
  it('get_auth_user 同时接受带包装与不带包装的响应', async () => {
    mockVercel(200, { user: { id: 'usr_1', username: 'ada', email: 'ada@example.com', extra: 'dropped' } })
    await expect((await call('get_auth_user', {})).json()).resolves.toEqual({
      content: { user: { id: 'usr_1', username: 'ada', email: 'ada@example.com' } },
    })

    vi.unstubAllGlobals()
    mockVercel(200, { id: 'usr_2', name: 'Grace' })
    await expect((await call('get_auth_user', {})).json()).resolves.toEqual({
      content: { user: { id: 'usr_2', name: 'Grace' } },
    })
  })

  it('get_team 同样两种形态都接', async () => {
    mockVercel(200, { team: { id: 'team_1', slug: 'acme', createdAt: 1700000000000 } })
    await expect((await call('get_team', { teamId: 'acme' })).json()).resolves.toEqual({
      content: { team: { id: 'team_1', slug: 'acme', createdAt: 1700000000000 } },
    })
  })

  it('项目出参裁剪掉未声明字段,并递归整形 latestDeployments', async () => {
    mockVercel(200, {
      id: 'prj_1',
      name: 'web',
      framework: 'nextjs',
      secretInternalField: 'dropped',
      latestDeployments: [{ id: 'dpl_1', url: 'web.vercel.app', internal: 'dropped' }],
    })
    await expect((await call('get_project', { idOrName: 'web' })).json()).resolves.toEqual({
      content: {
        project: {
          id: 'prj_1',
          name: 'web',
          framework: 'nextjs',
          latestDeployments: [{ id: 'dpl_1', url: 'web.vercel.app' }],
        },
      },
    })
  })

  it('列表出参带上 pagination,没有 pagination 时整个键不出现', async () => {
    mockVercel(200, { projects: [PROJECT], pagination: { count: 1, next: null } })
    await expect((await call('list_projects', {})).json()).resolves.toEqual({
      content: { projects: [{ id: 'prj_1', name: 'web' }], pagination: { count: 1, next: null } },
    })

    vi.unstubAllGlobals()
    mockVercel(200, { projects: [] })
    await expect((await call('list_projects', {})).json())
      .resolves.toEqual({ content: { projects: [] } })
  })

  it('domain.redirect 的 null 留住,"字段缺席"则整个键不出现', async () => {
    mockVercel(200, { name: 'a.com', redirect: null, verified: false })
    await expect((await call('get_project_domain', { idOrName: 'web', domain: 'a.com' })).json())
      .resolves.toEqual({ content: { domain: { name: 'a.com', redirect: null, verified: false } } })

    vi.unstubAllGlobals()
    mockVercel(200, { name: 'b.com' })
    await expect((await call('get_project_domain', { idOrName: 'web', domain: 'b.com' })).json())
      .resolves.toEqual({ content: { domain: { name: 'b.com' } } })
  })

  it('events 端点直接回数组(不带包装),也照样整形', async () => {
    mockVercel(200, [
      { created: 1, type: 'stdout', payload: { text: 'hello' } },
      { created: 2, type: 'command', payload: {} },
    ])
    await expect((await call('get_deployment_events', { idOrUrl: 'dpl_1' })).json()).resolves.toEqual({
      content: {
        events: [
          { created: 1, type: 'stdout', payload: { text: 'hello' } },
          { created: 2, type: 'command', payload: {} },
        ],
      },
    })
  })

  it('列表键缺失时兜底成空数组,而不是报错', async () => {
    mockVercel(200, {})
    await expect((await call('list_webhooks', {})).json())
      .resolves.toEqual({ content: { webhooks: [] } })
  })

  it('delete_project_env 遇到空响应体不炸,回空 envs', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(new Response('', { status: 200 }))))
    await expect((await call('delete_project_env', { idOrName: 'web', id: 'env_1' })).json())
      .resolves.toEqual({ content: { envs: [] } })
  })

  it('出参契约字段缺失 → unavailable + retryable(上游报的是 400,那会误导调用方)', async () => {
    mockVercel(200, { name: 'web' })
    const res = await call('get_project', { idOrName: 'web' })
    expect(res.status).toBe(503)
    await expect(res.json()).resolves.toMatchObject({ code: 'unavailable', retryable: true })

    vi.unstubAllGlobals()
    // event.created 不是数字 —— 同样是上游的问题。
    mockVercel(200, [{ created: 'nope', type: 'stdout', payload: {} }])
    await expect((await call('get_deployment_events', { idOrUrl: 'dpl_1' })).json())
      .resolves.toMatchObject({ code: 'unavailable', retryable: true })
  })
})

describe('校验与错误', () => {
  it('sensitive 类型 + development target 在本地就拒,不打上游', async () => {
    const mock = mockVercel(200, { envs: [] })
    const res = await call('create_project_env', {
      idOrName: 'web',
      key: 'SECRET',
      value: 'x',
      type: 'sensitive',
      target: ['production', 'development'],
    })
    expect(res.status).toBe(400)
    await expect(res.json()).resolves.toMatchObject({ code: 'invalid_argument' })
    expect(mock).not.toHaveBeenCalled()
  })

  it('同样的前置校验也作用于 update_project_env;不含 development 时放行', async () => {
    const rejected = mockVercel(200, ENV_VAR)
    expect((await call('update_project_env', {
      idOrName: 'web',
      id: 'env_1',
      key: 'SECRET',
      value: 'x',
      type: 'sensitive',
      target: ['development'],
    })).status).toBe(400)
    expect(rejected).not.toHaveBeenCalled()

    vi.unstubAllGlobals()
    const allowed = mockVercel(200, ENV_VAR)
    expect((await call('update_project_env', {
      idOrName: 'web',
      id: 'env_1',
      key: 'SECRET',
      value: 'x',
      type: 'sensitive',
      target: ['production'],
    })).status).toBe(200)
    expect(allowed).toHaveBeenCalledOnce()
  })

  it('入参校验真的生效:limit 越界 / 非法枚举 / 未声明字段 → 400 且不打上游', async () => {
    const mock = mockVercel(200, {})
    expect((await call('list_projects', { limit: 500 })).status).toBe(400)
    expect((await call('get_deployment_events', { idOrUrl: 'd', direction: 'sideways' })).status).toBe(400)
    expect((await call('create_webhook', { url: 'not-a-url', events: ['x'] })).status).toBe(400)
    expect((await call('get_auth_user', { nope: 1 })).status).toBe(400)
    expect((await call('get_project', {})).status).toBe(400)
    expect(mock).not.toHaveBeenCalled()
  })

  it('上游错误消息取自 error.message,退回顶层 message', async () => {
    mockVercel(400, { error: { code: 'bad_request', message: 'Invalid project name' } })
    const invalid = await call('create_project', { name: 'BAD' })
    expect(invalid.status).toBe(400)
    await expect(invalid.json()).resolves.toMatchObject({
      code: 'invalid_argument',
      message: 'Invalid project name',
    })

    vi.unstubAllGlobals()
    mockVercel(400, { message: 'top level message' })
    await expect((await call('create_project', { name: 'x' })).json())
      .resolves.toMatchObject({ message: 'top level message' })
  })

  it('404 → not_found,409 → conflict —— 上游把两者都压成 400(有意偏离)', async () => {
    mockVercel(404, { error: { code: 'not_found', message: 'Project not found' } })
    const missing = await call('get_project', { idOrName: 'nope' })
    expect(missing.status).toBe(404)
    await expect(missing.json()).resolves.toMatchObject({ code: 'not_found', message: 'Project not found' })

    vi.unstubAllGlobals()
    mockVercel(409, { error: { code: 'conflict', message: 'Domain already exists' } })
    const conflict = await call('add_project_domain', { idOrName: 'web', name: 'a.com' })
    expect(conflict.status).toBe(409)
    await expect(conflict.json()).resolves.toMatchObject({ code: 'conflict' })
  })

  it('401 → permission_denied;403 也是;429 与 5xx 可重试', async () => {
    mockVercel(401, { error: { message: 'Not authorized' } })
    expect((await call('get_auth_user', {})).status).toBe(401)

    vi.unstubAllGlobals()
    mockVercel(403, { error: { message: 'Scope missing' } })
    await expect((await call('get_auth_user', {})).json())
      .resolves.toMatchObject({ code: 'permission_denied' })

    vi.unstubAllGlobals()
    mockVercel(429, { error: { message: 'Rate limited' } })
    await expect((await call('get_auth_user', {})).json())
      .resolves.toMatchObject({ code: 'rate_limited', retryable: true })

    vi.unstubAllGlobals()
    mockVercel(503, {})
    await expect((await call('get_auth_user', {})).json())
      .resolves.toMatchObject({ code: 'unavailable', retryable: true, message: 'Vercel 返回 HTTP 503' })
  })

  it('错误体是 HTML 时把原文当消息;是 JSON 但没 message 时不回显整个 body', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(new Response('<html>gateway</html>', { status: 502 }))))
    await expect((await call('get_auth_user', {})).json())
      .resolves.toMatchObject({ code: 'unavailable', message: '<html>gateway</html>' })

    vi.unstubAllGlobals()
    mockVercel(400, { internalTrace: 'do-not-leak' })
    await expect((await call('get_auth_user', {})).json())
      .resolves.toMatchObject({ code: 'invalid_argument', message: 'Vercel 返回 HTTP 400' })
  })

  it('2xx 上回非 JSON → unavailable + retryable(而不是裸 SyntaxError 变成 internal 500)', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(new Response('<html>oops</html>', { status: 200 }))))
    const res = await call('get_auth_user', {})
    expect(res.status).toBe(503)
    await expect(res.json()).resolves.toMatchObject({ code: 'unavailable', retryable: true })
  })

  it('没配 authRef → unavailable 且不打上游', async () => {
    const mock = mockVercel(200, {})
    const res = await call('get_auth_user', {}, { auth: null })
    expect(res.status).toBe(503)
    expect(((await res.json()) as { message: string }).message).toContain('authRef')
    expect(mock).not.toHaveBeenCalled()
  })
})
