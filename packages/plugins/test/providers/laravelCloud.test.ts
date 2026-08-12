import {
  base64urlEncode,
  type CallContext,
  encodeCallContext,
  HEADER_TB_CONTEXT,
  HEADER_TB_UPSTREAM_AUTH,
} from '@tool-bridge/core'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createLaravelCloudPlugin } from '../../src/laravel_cloud/index'
import { laravelCloudActions } from '../../src/laravel_cloud/schema'

/**
 * Laravel Cloud 迁移产物的 wire 级验收。重点在 JSON:API 的两处约定:过滤器写成
 * `filter[x]`、关联展开写成 `include=a,b`,以及 `attributes` 里 snake_case 提到顶层。
 */

const PLUGIN_TOKEN = 'tbp_test'
const ENV = { PLUGIN_TOKEN }
const API_KEY = 'lc_token_deadbeef'
const plugin = createLaravelCloudPlugin()

const CALLER: CallContext = {
  keyId: 'k1',
  owner: 'agent:tester',
  scopes: [],
  traceId: 't1',
  mountPath: 'infra/laravel-cloud',
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

function mockLaravelCloud(status: number, payload: unknown): ReturnType<typeof vi.fn> {
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

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('契约面', () => {
  it('List 出全部 8 个 action,且都带 Zod 派生的 schema', async () => {
    const res = await envelope({ tool: 'List', arguments: {} })
    const tools = (await res.json()) as Array<{ inputSchema?: unknown, name: string, outputSchema?: unknown }>
    expect(tools).toHaveLength(Object.keys(laravelCloudActions).length)
    expect(tools).toHaveLength(8)
    for (const tool of tools) {
      expect(tool.inputSchema, `${tool.name} 缺 inputSchema`).toBeDefined()
      expect(tool.outputSchema, `${tool.name} 缺 outputSchema`).toBeDefined()
    }
  })

  it('全部 action 都是只读', async () => {
    const res = await envelope({ tool: 'List', arguments: {} })
    const tools = (await res.json()) as Array<{ effect?: string, name: string }>
    for (const tool of tools) expect(tool.effect, tool.name).toBe('read')
  })
})

describe('JSON:API 请求构造', () => {
  it('list_applications 的过滤器写成 filter[x],include 写成逗号串', async () => {
    const mock = mockLaravelCloud(200, { data: [], links: { next: null }, meta: { total: 0 } })
    await call('list_applications', {
      name: 'shop',
      region: 'eu-central-1',
      include: ['organization', 'environments'],
    })

    const url = new URL(sent(mock).url)
    expect(url.origin + url.pathname).toBe('https://cloud.laravel.com/api/applications')
    expect(url.searchParams.get('filter[name]')).toBe('shop')
    expect(url.searchParams.get('filter[region]')).toBe('eu-central-1')
    expect(url.searchParams.has('filter[slug]')).toBe(false)
    expect(url.searchParams.get('include')).toBe('organization,environments')
    expect(sent(mock).headers.get('authorization')).toBe(`Bearer ${API_KEY}`)
    expect(sent(mock).headers.get('user-agent')).toBeNull()
  })

  it('list_deployments 的 camelCase 入参映射到 snake_case 过滤器', async () => {
    const mock = mockLaravelCloud(200, { data: [] })
    await call('list_deployments', { environmentId: 'env_1', branchName: 'main', commitHash: 'abc123' })

    const url = new URL(sent(mock).url)
    expect(url.pathname).toBe('/api/environments/env_1/deployments')
    expect(url.searchParams.get('filter[branch_name]')).toBe('main')
    expect(url.searchParams.get('filter[commit_hash]')).toBe('abc123')
  })

  it('路径参数被 URL 编码', async () => {
    const mock = mockLaravelCloud(200, { data: { id: 'a/b', attributes: {} } })
    await call('get_environment', { environmentId: 'a/b' })
    expect(new URL(sent(mock).url).pathname).toBe('/api/environments/a%2Fb')
  })
})

describe('响应归一', () => {
  it('attributes 里的 snake_case 被提成 camelCase,raw 保留原资源', async () => {
    mockLaravelCloud(200, {
      data: {
        id: 'env_1',
        type: 'environments',
        attributes: {
          name: 'production',
          vanity_domain: 'shop.laravel.cloud',
          php_major_version: '8.3',
          uses_octane: true,
        },
      },
    })
    await expect((await call('get_environment', { environmentId: 'env_1' })).json()).resolves.toMatchObject({
      content: {
        environment: {
          id: 'env_1',
          name: 'production',
          vanityDomain: 'shop.laravel.cloud',
          phpMajorVersion: '8.3',
          usesOctane: true,
          // 上游对缺失字段一律回 null 而非省略。
          nodeVersion: null,
          raw: { id: 'env_1', type: 'environments' },
        },
        included: null,
      },
    })
  })

  it('列表的 links/meta/included 原样透出', async () => {
    mockLaravelCloud(200, {
      data: [{ id: 'app_1', type: 'applications', attributes: { name: 'Shop', slug: 'shop' } }],
      links: { next: 'https://cloud.laravel.com/api/applications?page=2' },
      meta: { total: 12 },
      included: [{ id: 'org_1', type: 'organizations' }],
    })
    await expect((await call('list_applications', {})).json()).resolves.toMatchObject({
      content: {
        applications: [{ id: 'app_1', name: 'Shop', slug: 'shop' }],
        meta: { total: 12 },
        included: [{ id: 'org_1', type: 'organizations' }],
      },
    })
  })

  it('regions 是扁平对象而非 JSON:API 资源', async () => {
    mockLaravelCloud(200, { data: [{ region: 'us-east-1', label: 'N. Virginia', flag: '🇺🇸' }] })
    await expect((await call('list_regions', {})).json()).resolves.toMatchObject({
      content: { regions: [{ region: 'us-east-1', label: 'N. Virginia' }] },
    })
  })

  it('data 形状不符 → unavailable(上游违约,不是调用方的错)', async () => {
    mockLaravelCloud(200, { data: { id: 'x' } })
    await expect((await call('list_regions', {})).json())
      .resolves.toMatchObject({ code: 'unavailable', retryable: true })
  })
})

describe('校验与错误', () => {
  it('入参校验生效:include 给未知枚举值 → 400 且不打上游', async () => {
    const mock = mockLaravelCloud(200, {})
    const res = await call('list_applications', { include: ['nope'] })
    expect(res.status).toBe(400)
    expect(((await res.json()) as { code: string }).code).toBe('invalid_argument')
    expect(mock).not.toHaveBeenCalled()
  })

  it('缺必填 applicationId → 400 且不打上游', async () => {
    const mock = mockLaravelCloud(200, {})
    expect((await call('get_application', {})).status).toBe(400)
    expect(mock).not.toHaveBeenCalled()
  })

  it('上游错误按状态归一', async () => {
    mockLaravelCloud(401, { message: 'Unauthenticated.' })
    const unauth = await call('get_organization', {})
    expect(unauth.status).toBe(401)
    await expect(unauth.json()).resolves.toMatchObject({
      code: 'permission_denied',
      message: 'Unauthenticated.',
    })

    mockLaravelCloud(429, { message: 'Too Many Attempts.' })
    await expect((await call('get_organization', {})).json())
      .resolves.toMatchObject({ code: 'rate_limited', retryable: true })

    // 上游把所有 4xx 压成 400;迁移后保留 not_found。
    mockLaravelCloud(404, { message: 'Not Found' })
    await expect((await call('get_application', { applicationId: 'nope' })).json())
      .resolves.toMatchObject({ code: 'not_found' })

    mockLaravelCloud(500, { message: 'Server Error' })
    await expect((await call('get_organization', {})).json())
      .resolves.toMatchObject({ code: 'unavailable', retryable: true })
  })

  it('没配 authRef → unavailable 且不打上游', async () => {
    const mock = mockLaravelCloud(200, {})
    const res = await call('get_organization', {}, { auth: null })
    expect(res.status).toBe(503)
    expect(((await res.json()) as { message: string }).message).toContain('authRef')
    expect(mock).not.toHaveBeenCalled()
  })
})
