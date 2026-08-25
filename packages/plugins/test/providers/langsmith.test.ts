import {
  type CallContext,
} from '@tool-bridge/core'
import { describe, expect, it, vi } from 'vitest'
import { createProviderHarness } from '../support/providerHarness'
import { createLangsmithPlugin } from '../../src/langsmith/index'
import { langsmithActions } from '../../src/langsmith/schema'

/**
 * LangSmith 迁移产物的 wire 级验收。重点在几个"迁移最容易迁丢"的地方:
 * region → API base 的四选一(配错要拒而不是静默落回 us)、workspaceId → `X-Tenant-Id`、
 * 入参名与线上参数名对不上的三处(`datasetId` → query `dataset` / body `dataset_id`、
 * `upsert` 进 query 而不是 body)、`full_text_contains` 数组展开成重复同名参数,
 * 以及出参裁剪里 nullable 与 optional 的区别。
 */

const API_KEY = 'lsv2_pt_deadbeef'
const plugin = createLangsmithPlugin()

function caller(mountConfig: Record<string, unknown> | undefined): CallContext {
  return {
    keyId: 'k1',
    owner: 'agent:tester',
    scopes: [],
    traceId: 't1',
    mountPath: 'ai/langsmith',
    exportId: 'actions',
    ...(mountConfig === undefined ? {} : { mountConfig }),
  }
}

interface CallOptions {
  auth?: string | null
  config?: Record<string, unknown> | undefined
}

const { call, envelope, sent, mockJson: mockLangsmith, env: ENV, stubFetch } = createProviderHarness<CallOptions>({
  caller: opts => caller('config' in opts ? opts.config : undefined),
  mountPath: 'ai/langsmith',
  plugin,
  upstreamAuth: API_KEY,
})

/** 直接给一段原始 body(测空体与非 JSON 错误体)。 */
function mockRaw(status: number, body: string | null): ReturnType<typeof vi.fn> {
  return stubFetch(() => Promise.resolve(new Response(body, { status })))
}

describe('契约面', () => {
  it('List 出全部 10 个 action,且都带 Zod 派生的 schema', async () => {
    const res = await envelope({ tool: 'List', arguments: {} })
    const tools = (await res.json()) as Array<{ inputSchema?: unknown, name: string, outputSchema?: unknown }>
    expect(tools).toHaveLength(Object.keys(langsmithActions).length)
    expect(tools).toHaveLength(10)
    expect(tools.map(tool => tool.name).sort()).toEqual([
      'create_dataset',
      'create_example',
      'create_project',
      'get_dataset',
      'get_example',
      'get_project',
      'list_datasets',
      'list_examples',
      'list_projects',
      'list_workspaces',
    ])
    for (const tool of tools) {
      expect(tool.inputSchema, `${tool.name} 缺 inputSchema`).toBeDefined()
      expect(tool.outputSchema, `${tool.name} 缺 outputSchema`).toBeDefined()
    }
  })

  it('~describe 报单个 tools/v1 export,凭证探针是 list_workspaces,且不声明多字段凭证', async () => {
    const res = await plugin.fetch(new Request('https://plugin.test/~describe'), ENV as never)
    const body = (await res.json()) as {
      exports: Array<Record<string, unknown> & { profile: string }>
    }
    expect(body.exports).toHaveLength(1)
    expect(body.exports[0]?.profile).toBe('tools/v1')
    expect(body.exports[0]?.credentialProbe).toBe('list_workspaces')
    // region / workspaceId 是配置不是密钥,不该占 secret 通道 —— 它们走 mountConfigFields。
    expect('credentials' in body.exports[0]!).toBe(false)
    expect(body.exports[0]?.mountConfigFields).toEqual([
      { key: 'region', label: '区域', description: 'us、eu、apac 或 aws_us 之一;留空用 us' },
      {
        key: 'workspaceId',
        label: 'Workspace ID',
        description: '限定到某个 workspace;留空用凭证的默认 workspace',
      },
    ])
  })
})

describe('region 与 workspace 的解算', () => {
  it('没配 region 时默认打 us', async () => {
    const mock = mockLangsmith(200, [])
    await call('list_workspaces', {})
    expect(new URL(sent(mock).url).origin).toBe('https://api.smith.langchain.com')
  })

  it('四个区域各打自己的域名,`aws` 是 `aws_us` 的别名(上游历史命名)', async () => {
    const cases: Array<[string, string]> = [
      ['us', 'https://api.smith.langchain.com'],
      ['eu', 'https://eu.api.smith.langchain.com'],
      ['apac', 'https://apac.api.smith.langchain.com'],
      ['aws_us', 'https://aws.api.smith.langchain.com'],
      ['aws', 'https://aws.api.smith.langchain.com'],
    ]
    for (const [region, origin] of cases) {
      vi.unstubAllGlobals()
      const mock = mockLangsmith(200, [])
      await call('list_workspaces', {}, { config: { region } })
      expect(new URL(sent(mock).url).origin, region).toBe(origin)
    }
  })

  it('region 配了没听过的值 → invalid_argument 且不打上游(静默落回 us 是数据出境问题)', async () => {
    const mock = mockLangsmith(200, [])
    const res = await call('list_workspaces', {}, { config: { region: 'cn' } })
    expect(res.status).toBe(400)
    await expect(res.json()).resolves.toMatchObject({ code: 'invalid_argument' })
    expect(mock).not.toHaveBeenCalled()
  })

  it('region 不是字符串 → invalid_argument(不 String() 硬转)', async () => {
    const mock = mockLangsmith(200, [])
    const res = await call('list_workspaces', {}, { config: { region: 42 } })
    expect(res.status).toBe(400)
    expect(mock).not.toHaveBeenCalled()
  })

  it('配了 workspaceId 就带 X-Tenant-Id;没配就不带这个头', async () => {
    const withTenant = mockLangsmith(200, [])
    await call('list_workspaces', {}, { config: { workspaceId: 'ws-1' } })
    expect(sent(withTenant).headers.get('X-Tenant-Id')).toBe('ws-1')

    vi.unstubAllGlobals()
    const without = mockLangsmith(200, [])
    await call('list_workspaces', {})
    expect(sent(without).headers.get('X-Tenant-Id')).toBeNull()
  })
})

describe('请求拼装', () => {
  it('list_workspaces:GET + X-Api-Key 头,可选参数进 query', async () => {
    const mock = mockLangsmith(200, [])
    await call('list_workspaces', { include_deleted: true, data_plane_id: '55555555-5555-4555-8555-555555555555' })

    const request = sent(mock)
    const url = new URL(request.url)
    expect(request.method).toBe('GET')
    expect(url.pathname).toBe('/api/v1/workspaces')
    expect(request.headers.get('X-Api-Key')).toBe(API_KEY)
    expect(request.headers.get('accept')).toBe('application/json')
    // GET 没有 body,也就不该带 content-type。
    expect(request.headers.get('content-type')).toBeNull()
    expect(Object.fromEntries(url.searchParams)).toEqual({
      include_deleted: 'true',
      data_plane_id: '55555555-5555-4555-8555-555555555555',
    })
  })

  it('create_project:upsert 进 query 而不是 body(放 body 会被忽略,同名项目直接 409)', async () => {
    const mock = mockLangsmith(200, { id: 'p1', tenant_id: 't1', name: 'demo' })
    await call('create_project', { name: 'demo', description: 'd', upsert: true })

    const request = sent(mock)
    const url = new URL(request.url)
    expect(request.method).toBe('POST')
    expect(url.pathname).toBe('/api/v1/sessions')
    expect(Object.fromEntries(url.searchParams)).toEqual({ upsert: 'true' })
    expect(request.headers.get('content-type')).toBe('application/json')
    await expect(request.json()).resolves.toEqual({ name: 'demo', description: 'd' })
  })

  it('list_examples:入参 datasetId 在线上叫 `dataset`', async () => {
    const mock = mockLangsmith(200, [])
    await call('list_examples', { datasetId: '11111111-1111-4111-8111-111111111111', limit: 10 })
    const url = new URL(sent(mock).url)
    expect(url.pathname).toBe('/api/v1/examples')
    expect(Object.fromEntries(url.searchParams)).toEqual({
      dataset: '11111111-1111-4111-8111-111111111111',
      limit: '10',
    })
    expect(url.searchParams.has('datasetId')).toBe(false)
  })

  it('create_example:同一个 datasetId 在建例子时叫 body 里的 `dataset_id`', async () => {
    const mock = mockLangsmith(200, { id: 'e1', dataset_id: 'd1' })
    await call('create_example', {
      datasetId: '11111111-1111-4111-8111-111111111111',
      inputs: { question: 'hi' },
      outputs: { answer: 'yo' },
    })
    const request = sent(mock)
    expect(new URL(request.url).pathname).toBe('/api/v1/examples')
    await expect(request.json()).resolves.toEqual({
      dataset_id: '11111111-1111-4111-8111-111111111111',
      inputs: { question: 'hi' },
      outputs: { answer: 'yo' },
    })
  })

  it('full_text_contains 数组展开成重复的同名参数(拼成逗号串语义就变了)', async () => {
    const mock = mockLangsmith(200, [])
    await call('list_examples', { full_text_contains: ['alpha', 'beta'] })
    expect(new URL(sent(mock).url).searchParams.getAll('full_text_contains')).toEqual(['alpha', 'beta'])
  })

  it('路径 id 被转义,且未给的可选参数不出现在 query 里', async () => {
    const mock = mockLangsmith(200, { id: 'p1', tenant_id: 't1' })
    await call('get_project', { projectId: '22222222-2222-4222-8222-222222222222' })
    const url = new URL(sent(mock).url)
    expect(url.pathname).toBe('/api/v1/sessions/22222222-2222-4222-8222-222222222222')
    expect([...url.searchParams.keys()]).toEqual([])
  })
})

describe('响应整形', () => {
  it('list_workspaces:裸数组包成 {workspaces},字段裁剪 + raw 逃生阀', async () => {
    mockLangsmith(200, [{
      id: 'ws-1',
      display_name: 'Personal',
      is_personal: true,
      tenant_handle: null,
      vendor_extra: 'kept-only-in-raw',
    }])
    const res = await call('list_workspaces', {})
    await expect(res.json()).resolves.toEqual({
      content: {
        workspaces: [{
          id: 'ws-1',
          organization_id: null,
          display_name: 'Personal',
          is_personal: true,
          is_deleted: false,
          tenant_handle: null,
          data_plane_url: null,
          raw: {
            id: 'ws-1',
            display_name: 'Personal',
            is_personal: true,
            tenant_handle: null,
            vendor_extra: 'kept-only-in-raw',
          },
        }],
      },
    })
  })

  it('example 的 nullable 字段:缺席与 null 都归 null,inputs 缺席归 {}', async () => {
    mockLangsmith(200, { id: 'e1', dataset_id: 'd1', outputs: null })
    const res = await call('get_example', { exampleId: '33333333-3333-4333-8333-333333333333' })
    await expect(res.json()).resolves.toMatchObject({
      content: {
        example: { inputs: {}, outputs: null, metadata: null, name: null },
      },
    })
  })

  it('run_count 只认真整数:小数与数字串都归 null(上游 nullableInteger)', async () => {
    mockLangsmith(200, { id: 'p1', tenant_id: 't1', run_count: 1.5, error_rate: 0.25 })
    const res = await call('get_project', { projectId: '22222222-2222-4222-8222-222222222222' })
    await expect(res.json()).resolves.toMatchObject({
      content: { project: { run_count: null, error_rate: 0.25 } },
    })
  })

  it('列表端点回对象(而非数组)→ unavailable + retryable,不当成功透出', async () => {
    mockLangsmith(200, { detail: 'not a list' })
    const res = await call('list_projects', {})
    expect(res.status).toBe(503)
    await expect(res.json()).resolves.toMatchObject({ code: 'unavailable', retryable: true })
  })

  it('单体端点回空体 → unavailable(payload 是 null,不是"空对象成功")', async () => {
    mockRaw(200, '')
    const res = await call('get_dataset', { datasetId: '44444444-4444-4444-8444-444444444444' })
    expect(res.status).toBe(503)
    await expect(res.json()).resolves.toMatchObject({ code: 'unavailable', retryable: true })
  })
})

describe('校验与错误', () => {
  it('入参校验真的生效:projectId 不是 UUID → 400 且不打上游', async () => {
    const mock = mockLangsmith(200, {})
    const res = await call('get_project', { projectId: 'not-a-uuid' })
    expect(res.status).toBe(400)
    expect(((await res.json()) as { code: string }).code).toBe('invalid_argument')
    expect(mock).not.toHaveBeenCalled()
  })

  it('get_dataset 的 datasetId 在 schema 里是 optional(忠实反映上游),缺它时本地挡下', async () => {
    // 上游 `String(input.datasetId)` 会把 undefined 拼成字面量 "undefined" 打过去,
    // 换来一个看不懂的 404;这里保留必填断言并归 invalid_argument。
    const mock = mockLangsmith(200, {})
    const res = await call('get_dataset', {})
    expect(res.status).toBe(400)
    await expect(res.json()).resolves.toMatchObject({ code: 'invalid_argument', message: /datasetId/ })
    expect(mock).not.toHaveBeenCalled()
  })

  it('上游错误按状态归一,消息取自 detail / message / error / title', async () => {
    mockLangsmith(401, { detail: 'Invalid API key' })
    const unauthorized = await call('list_workspaces', {})
    expect(unauthorized.status).toBe(401)
    await expect(unauthorized.json()).resolves.toMatchObject({
      code: 'permission_denied',
      message: 'Invalid API key',
    })

    vi.unstubAllGlobals()
    mockLangsmith(422, { title: 'Validation error' })
    const invalid = await call('create_dataset', { name: 'x' })
    expect(invalid.status).toBe(400)
    await expect(invalid.json()).resolves.toMatchObject({
      code: 'invalid_argument',
      message: 'Validation error',
    })

    vi.unstubAllGlobals()
    mockLangsmith(429, { message: 'Too many requests' })
    const limited = await call('list_workspaces', {})
    expect(limited.status).toBe(429)
    await expect(limited.json()).resolves.toMatchObject({ code: 'rate_limited', retryable: true })

    vi.unstubAllGlobals()
    mockLangsmith(500, { error: 'LangSmith is down' })
    const down = await call('list_workspaces', {})
    expect(down.status).toBe(503)
    await expect(down.json()).resolves.toMatchObject({ code: 'unavailable', retryable: true })
  })

  it('404 归 not_found(上游把它压成 400,这里保留区分度)', async () => {
    mockLangsmith(404, { detail: 'Dataset not found' })
    const res = await call('get_dataset', { datasetId: '44444444-4444-4444-8444-444444444444' })
    expect(res.status).toBe(404)
    await expect(res.json()).resolves.toMatchObject({ code: 'not_found', message: 'Dataset not found' })
  })

  it('错误体不是 JSON 时用原文当消息;连原文都没有就退回状态行', async () => {
    mockRaw(502, 'upstream connect error')
    const withText = await call('list_workspaces', {})
    await expect(withText.json()).resolves.toMatchObject({
      code: 'unavailable',
      message: 'upstream connect error',
      retryable: true,
    })

    vi.unstubAllGlobals()
    mockRaw(503, '')
    const withoutText = await call('list_workspaces', {})
    const fallback = (await withoutText.json()) as { code: string, message: string, retryable: boolean }
    expect(fallback).toMatchObject({ code: 'unavailable', retryable: true })
    // 上游 `?? response.statusText` 在 statusText 为空串时会产出空消息,这里必须有兜底。
    expect(fallback.message).not.toBe('')
  })

  it('没配 authRef → unavailable 且不打上游', async () => {
    const mock = mockLangsmith(200, [])
    const res = await call('list_workspaces', {}, { auth: null })
    expect(res.status).toBe(503)
    expect(((await res.json()) as { message: string }).message).toContain('authRef')
    expect(mock).not.toHaveBeenCalled()
  })

  it('缺凭证的报错优先于 region 配错(配置错误不被传输兜底吞掉)', async () => {
    const mock = mockLangsmith(200, [])
    const res = await call('list_workspaces', {}, { auth: null, config: { region: 'cn' } })
    expect(res.status).toBe(503)
    expect(mock).not.toHaveBeenCalled()
  })
})
