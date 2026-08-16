import {
  base64urlEncode,
  type CallContext,
  encodeCallContext,
  HEADER_TB_CONTEXT,
  HEADER_TB_UPSTREAM_AUTH,
} from '@tool-bridge/core'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod/v4'
import { createCircleciPlugin } from '../../src/circleci/index'
import { circleciActions } from '../../src/circleci/schema'

/**
 * CircleCI 迁移产物的 wire 级验收。重点在几个"迁移最容易迁丢"的地方:
 * projectSlug 整体编码成一个路径段(以及粘贴来的 `project/` 前缀与 `%2F` 的归一)、
 * 两个 job 端点的路径不对称、camelCase 入参到连字符 query 键的映射、互斥参数的断言。
 */

const PLUGIN_TOKEN = 'tbp_test'
const ENV = { PLUGIN_TOKEN }
const API_KEY = 'circleci_token_deadbeef'
const plugin = createCircleciPlugin()

const CALLER: CallContext = {
  keyId: 'k1',
  owner: 'agent:tester',
  scopes: [],
  traceId: 't1',
  mountPath: 'ci/circleci',
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

function mockCircleci(status: number, payload: unknown): ReturnType<typeof vi.fn> {
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

/** URL 里 slug 那一段是编码过的,断言要看**原始** pathname 而不是 URL 解码后的。 */
function pathOf(mock: ReturnType<typeof vi.fn>): string {
  return new URL(sent(mock).url).pathname
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('契约面', () => {
  it('~describe 报成单个 tools/v1 export,并报出凭证探针', async () => {
    const res = await plugin.fetch(new Request('https://plugin.test/~describe'), ENV as never)
    await expect(res.json()).resolves.toEqual({
      protocolVersion: 'plugin/v2',
      exports: [{
        auth: { kind: 'single', required: true },
        id: 'actions',
        profile: 'tools/v1',
        description: 'CircleCI',
        credentialProbe: 'get_current_user',
      }],
    })
  })

  it('探针指向的工具只读且无必填入参(平台挂载时会空参调它)', () => {
    const spec = circleciActions.get_current_user
    expect(spec.effect).toBe('read')
    const schema = z.toJSONSchema(spec.inputSchema, { io: 'input' }) as { required?: string[] }
    expect(schema.required ?? []).toEqual([])
  })

  it('List 出全部 11 个 action,且都带 Zod 派生的 schema', async () => {
    const res = await envelope({ tool: 'List', arguments: {} })
    const tools = (await res.json()) as Array<{ inputSchema?: unknown, name: string, outputSchema?: unknown }>
    expect(tools).toHaveLength(Object.keys(circleciActions).length)
    expect(tools).toHaveLength(11)
    for (const tool of tools) {
      expect(tool.inputSchema, `${tool.name} 缺 inputSchema`).toBeDefined()
      expect(tool.outputSchema, `${tool.name} 缺 outputSchema`).toBeDefined()
    }
  })
})

describe('请求成形', () => {
  it('get_current_user:GET /api/v2/me,凭证走 circle-token 头', async () => {
    const mock = mockCircleci(200, { id: 'u1', login: 'octo' })
    const res = await call('get_current_user', {})

    const request = sent(mock)
    expect(request.method).toBe('GET')
    expect(new URL(request.url).origin + pathOf(mock)).toBe('https://circleci.com/api/v2/me')
    expect(request.headers.get('circle-token')).toBe(API_KEY)
    expect(request.headers.get('accept')).toBe('application/json')
    expect(request.headers.get('authorization')).toBeNull()
    await expect(res.json()).resolves.toEqual({ content: { id: 'u1', login: 'octo' } })
  })

  it('projectSlug 整体是一个路径段:斜杠要编码成 %2F,不能拆成三段', async () => {
    const mock = mockCircleci(200, { slug: 'gh/acme/repo' })
    await call('get_project', { projectSlug: 'gh/acme/repo' })
    expect(pathOf(mock)).toBe('/api/v2/project/gh%2Facme%2Frepo')
  })

  it('粘贴来的 project/ 前缀、已编码的 %2F、首尾斜杠都先归一再编码', async () => {
    const prefixed = mockCircleci(200, {})
    await call('get_project', { projectSlug: 'project/gh/acme/repo' })
    expect(pathOf(prefixed)).toBe('/api/v2/project/gh%2Facme%2Frepo')

    vi.unstubAllGlobals()
    const encoded = mockCircleci(200, {})
    await call('get_project', { projectSlug: 'gh%2Facme%2Frepo' })
    expect(pathOf(encoded)).toBe('/api/v2/project/gh%2Facme%2Frepo')

    vi.unstubAllGlobals()
    const slashed = mockCircleci(200, {})
    await call('get_project', { projectSlug: '/project/gh/acme/repo/' })
    expect(pathOf(slashed)).toBe('/api/v2/project/gh%2Facme%2Frepo')
  })

  it('list_pipelines_for_project:camelCase 的 pageToken 映射成连字符的 page-token', async () => {
    const mock = mockCircleci(200, { items: [], next_page_token: null })
    await call('list_pipelines_for_project', {
      projectSlug: 'gh/acme/repo',
      branch: 'main',
      pageToken: 'tok1',
    })
    const url = new URL(sent(mock).url)
    expect(url.pathname).toBe('/api/v2/project/gh%2Facme%2Frepo/pipeline')
    expect(Object.fromEntries(url.searchParams)).toEqual({ 'branch': 'main', 'page-token': 'tok1' })
  })

  it('pipeline 相关的两个端点走 /pipeline/{id},pageToken 同样连字符化', async () => {
    const one = mockCircleci(200, { id: 'p1' })
    await call('get_pipeline', { pipelineId: 'p1' })
    expect(pathOf(one)).toBe('/api/v2/pipeline/p1')

    vi.unstubAllGlobals()
    const workflows = mockCircleci(200, { items: [] })
    await call('list_workflows_by_pipeline', { pipelineId: 'p1', pageToken: 'tok2' })
    expect(pathOf(workflows)).toBe('/api/v2/pipeline/p1/workflow')
    expect(new URL(sent(workflows).url).searchParams.get('page-token')).toBe('tok2')
  })

  it('两个 job 端点的路径不对称:详情带 /job/,产物不带', async () => {
    const details = mockCircleci(200, { number: 42 })
    await call('get_job_details', { projectSlug: 'gh/acme/repo', jobNumber: 42 })
    expect(pathOf(details)).toBe('/api/v2/project/gh%2Facme%2Frepo/job/42')

    vi.unstubAllGlobals()
    const artifacts = mockCircleci(200, { items: [] })
    await call('get_job_artifacts', { projectSlug: 'gh/acme/repo', jobNumber: 42 })
    expect(pathOf(artifacts)).toBe('/api/v2/project/gh%2Facme%2Frepo/42/artifacts')
  })

  it('insights 的两个端点:workflow summary 与 org summary', async () => {
    const workflow = mockCircleci(200, { metrics: {} })
    await call('get_workflow_summary', {
      projectSlug: 'gh/acme/repo',
      workflowName: 'build and test',
      allBranches: true,
    })
    expect(pathOf(workflow)).toBe('/api/v2/insights/gh%2Facme%2Frepo/workflows/build%20and%20test/summary')
    expect(new URL(sent(workflow).url).searchParams.get('all-branches')).toBe('true')

    vi.unstubAllGlobals()
    const org = mockCircleci(200, { org_data: {} })
    await call('list_insights_summary', { orgSlug: 'gh/acme', reportingWindow: 'last-7-days' })
    expect(pathOf(org)).toBe('/api/v2/insights/gh%2Facme/summary')
    expect(new URL(sent(org).url).searchParams.get('reporting-window')).toBe('last-7-days')
  })

  it('orgSlug 不剥 project/ 前缀(那是 projectSlug 才有的粘贴习惯)', async () => {
    const mock = mockCircleci(200, {})
    await call('list_insights_summary', { orgSlug: 'project/gh' })
    expect(pathOf(mock)).toBe('/api/v2/insights/project%2Fgh/summary')
  })

  it('trigger_pipeline:POST + JSON body,未给的字段不进 body', async () => {
    const mock = mockCircleci(201, { id: 'p2', state: 'created', number: 7 })
    const res = await call('trigger_pipeline', {
      projectSlug: 'gh/acme/repo',
      branch: 'main',
      parameters: { deploy: true, env: 'prod', retries: 2 },
    })

    const request = sent(mock)
    expect(request.method).toBe('POST')
    expect(new URL(request.url).pathname).toBe('/api/v2/project/gh%2Facme%2Frepo/pipeline')
    expect(request.headers.get('content-type')).toBe('application/json')
    await expect(request.json()).resolves.toEqual({
      branch: 'main',
      parameters: { deploy: true, env: 'prod', retries: 2 },
    })
    await expect(res.json()).resolves.toMatchObject({ content: { id: 'p2', number: 7 } })
  })

  it('list_project_env_vars 走 /envvar', async () => {
    const mock = mockCircleci(200, { items: [{ name: 'TOKEN', value: 'xxxx1234' }] })
    await call('list_project_env_vars', { projectSlug: 'gh/acme/repo' })
    expect(pathOf(mock)).toBe('/api/v2/project/gh%2Facme%2Frepo/envvar')
  })

  it('GET 不带 body,也不带 content-type', async () => {
    const mock = mockCircleci(200, {})
    await call('get_project', { projectSlug: 'gh/acme/repo' })
    expect(await sent(mock).text()).toBe('')
    expect(sent(mock).headers.get('content-type')).toBeNull()
  })
})

describe('校验与错误', () => {
  it('allBranches 与 branch 互斥 → invalid_argument 且不打上游', async () => {
    const mock = mockCircleci(200, {})
    const res = await call('get_workflow_summary', {
      projectSlug: 'gh/acme/repo',
      workflowName: 'build',
      allBranches: false,
      branch: 'main',
    })
    expect(res.status).toBe(400)
    expect(((await res.json()) as { message: string }).message).toContain('allBranches')
    expect(mock).not.toHaveBeenCalled()
  })

  it('branch 与 tag 互斥 → invalid_argument 且不打上游', async () => {
    const mock = mockCircleci(200, {})
    const res = await call('trigger_pipeline', { projectSlug: 'gh/acme/repo', branch: 'main', tag: 'v1' })
    expect(res.status).toBe(400)
    expect(((await res.json()) as { code: string }).code).toBe('invalid_argument')
    expect(mock).not.toHaveBeenCalled()
  })

  it('归一后为空的 slug 当场拒(否则会打到 /project//pipeline 这种路径上)', async () => {
    const mock = mockCircleci(200, {})
    for (const slug of ['project/', '///', '   /  ']) {
      const res = await call('get_project', { projectSlug: slug })
      expect(res.status, slug).toBe(400)
      expect(((await res.json()) as { message: string }).message).toContain('projectSlug')
    }
    expect(mock).not.toHaveBeenCalled()
  })

  it('半截百分号编码的 slug 也当场拒,而不是让 decodeURIComponent 抛出裸 Error', async () => {
    const mock = mockCircleci(200, {})
    const res = await call('get_project', { projectSlug: 'gh%2Facme%2' })
    expect(res.status).toBe(400)
    expect(((await res.json()) as { code: string }).code).toBe('invalid_argument')
    expect(mock).not.toHaveBeenCalled()
  })

  it('入参校验真的生效:jobNumber 必须是正整数 → 400 且不打上游', async () => {
    const mock = mockCircleci(200, {})
    const res = await call('get_job_details', { projectSlug: 'gh/acme/repo', jobNumber: 0 })
    expect(res.status).toBe(400)
    expect(mock).not.toHaveBeenCalled()
  })

  it('404 如实回 not_found(上游压成 400,这里不压)', async () => {
    mockCircleci(404, { message: 'Project not found' })
    const res = await call('get_project', { projectSlug: 'gh/acme/nope' })
    expect(res.status).toBe(404)
    await expect(res.json()).resolves.toMatchObject({
      code: 'not_found',
      message: 'Project not found',
    })
  })

  it('403 如实回 permission_denied(上游压成 502,那是可重试码,会让 agent 白重试)', async () => {
    mockCircleci(403, { message: 'Permission denied' })
    const res = await call('list_project_env_vars', { projectSlug: 'gh/acme/repo' })
    expect(res.status).toBe(403)
    const body = (await res.json()) as { code: string, retryable?: boolean }
    expect(body.code).toBe('permission_denied')
    // 关键在这一条:permission_denied 不是可重试码。
    expect(body.retryable).toBeFalsy()
  })

  it('401 → permission_denied,429 → rate_limited,5xx → unavailable + retryable', async () => {
    mockCircleci(401, { message: 'Unauthorized' })
    expect((await call('get_current_user', {})).status).toBe(401)

    vi.unstubAllGlobals()
    mockCircleci(429, { message: 'Too many requests' })
    await expect((await call('get_current_user', {})).json())
      .resolves.toMatchObject({ code: 'rate_limited', retryable: true })

    vi.unstubAllGlobals()
    mockCircleci(500, { error: 'boom' })
    await expect((await call('get_current_user', {})).json())
      .resolves.toMatchObject({ code: 'unavailable', retryable: true, message: 'boom' })
  })

  it('错误响应回 HTML 时按状态归一,而不是报"响应不是 JSON"', async () => {
    const fn = vi.fn(() => Promise.resolve(new Response('<html>401</html>', { status: 401 })))
    vi.stubGlobal('fetch', fn)
    const res = await call('get_current_user', {})
    expect(res.status).toBe(401)
    await expect(res.json()).resolves.toMatchObject({
      code: 'permission_denied',
      message: '<html>401</html>',
    })
  })

  it('2xx 回非 JSON 才算上游坏了 → unavailable', async () => {
    const fn = vi.fn(() => Promise.resolve(new Response('<html>ok?</html>', { status: 200 })))
    vi.stubGlobal('fetch', fn)
    await expect((await call('get_current_user', {})).json())
      .resolves.toMatchObject({ code: 'unavailable', retryable: true })
  })

  it('空正文的 2xx 按空对象处理(上游删除类端点会这样回)', async () => {
    const fn = vi.fn(() => Promise.resolve(new Response('   ', { status: 200 })))
    vi.stubGlobal('fetch', fn)
    await expect((await call('get_current_user', {})).json()).resolves.toEqual({ content: {} })
  })

  it('没配 authRef → unavailable 且不打上游', async () => {
    const mock = mockCircleci(200, {})
    const res = await call('get_current_user', {}, { auth: null })
    expect(res.status).toBe(503)
    expect(((await res.json()) as { message: string }).message).toContain('authRef')
    expect(mock).not.toHaveBeenCalled()
  })
})
