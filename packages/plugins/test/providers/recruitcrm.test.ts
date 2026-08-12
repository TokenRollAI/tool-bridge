import {
  base64urlEncode,
  type CallContext,
  encodeCallContext,
  HEADER_TB_CONTEXT,
  HEADER_TB_UPSTREAM_AUTH,
} from '@tool-bridge/core'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createRecruitcrmPlugin } from '../../src/recruitcrm/index'
import { recruitcrmActions } from '../../src/recruitcrm/schema'

/**
 * Recruit CRM 迁移产物的 wire 级验收。重点在几个"迁移最容易迁丢"的地方:
 * 载荷键在资源名与 `data` 之间摇摆、详情的路径参数不叫 id、schema 说 optional
 * 但缺了就拼不出路径。
 */

const PLUGIN_TOKEN = 'tbp_test'
const ENV = { PLUGIN_TOKEN }
const API_KEY = 'rcrm_token_deadbeef'
const plugin = createRecruitcrmPlugin()

const CALLER: CallContext = {
  keyId: 'k1',
  owner: 'agent:tester',
  scopes: [],
  traceId: 't1',
  mountPath: 'hr/recruitcrm',
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

function mockRecruitcrm(status: number, payload: unknown): ReturnType<typeof vi.fn> {
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
    expect(tools).toHaveLength(Object.keys(recruitcrmActions).length)
    expect(tools).toHaveLength(8)
    for (const tool of tools) {
      expect(tool.inputSchema, `${tool.name} 缺 inputSchema`).toBeDefined()
      expect(tool.outputSchema, `${tool.name} 缺 outputSchema`).toBeDefined()
    }
  })

  it('八个 action 全是只读', async () => {
    const res = await envelope({ tool: 'List', arguments: {} })
    const tools = (await res.json()) as Array<{ effect?: string, name: string }>
    for (const tool of tools) {
      expect(tool.effect, `${tool.name} 不是 read`).toBe('read')
    }
  })
})

describe('请求成形', () => {
  it('凭证走 Bearer,分页参数进 query', async () => {
    const mock = mockRecruitcrm(200, { candidates: [] })
    await call('list_candidates', { page: 2, limit: 25 })
    const request = sent(mock)
    const url = new URL(request.url)
    expect(url.origin + url.pathname).toBe('https://api.recruitcrm.io/v1/candidates')
    expect(request.headers.get('authorization')).toBe(`Bearer ${API_KEY}`)
    expect(url.searchParams.get('page')).toBe('2')
    expect(url.searchParams.get('limit')).toBe('25')
  })

  it('省略的分页参数不出现在 query 里', async () => {
    const mock = mockRecruitcrm(200, { jobs: [] })
    await call('list_jobs', {})
    expect([...new URL(sent(mock).url).searchParams.keys()]).toEqual([])
  })

  it('详情的路径参数是资源名而非 id,且被 URL 编码', async () => {
    const mock = mockRecruitcrm(200, { company: { id: 1 } })
    await call('get_company', { company: 'acme/inc' })
    expect(sent(mock).url).toBe('https://api.recruitcrm.io/v1/companies/acme%2Finc')
  })
})

describe('响应归一', () => {
  it('列表载荷键无论叫资源名还是 data 都能取出', async () => {
    mockRecruitcrm(200, { contacts: [{ id: 1 }], pagination: { total: 1 } })
    await expect((await call('list_contacts', {})).json()).resolves.toEqual({
      content: {
        contacts: [{ id: 1 }],
        pagination: { total: 1 },
        raw: { contacts: [{ id: 1 }], pagination: { total: 1 } },
      },
    })

    // 换成 data 键,结果形状不变;pagination 缺失时退化成空对象。
    mockRecruitcrm(200, { data: [{ id: 2 }] })
    await expect((await call('list_contacts', {})).json()).resolves.toEqual({
      content: { contacts: [{ id: 2 }], pagination: {}, raw: { data: [{ id: 2 }] } },
    })
  })

  it('详情载荷键同理,raw 保留完整响应', async () => {
    mockRecruitcrm(200, { data: { id: 9, name: 'Ada' } })
    await expect((await call('get_candidate', { candidate: 'ada' })).json()).resolves.toEqual({
      content: { candidate: { id: 9, name: 'Ada' }, raw: { data: { id: 9, name: 'Ada' } } },
    })
  })

  it('两个键都拿不到 → unavailable(不把坏数据当空结果吞掉)', async () => {
    mockRecruitcrm(200, { unexpected: [] })
    await expect((await call('list_jobs', {})).json())
      .resolves.toMatchObject({ code: 'unavailable' })
  })
})

describe('校验与错误', () => {
  it('入参校验真的生效:page 为 0 → 400 且不打上游', async () => {
    const mock = mockRecruitcrm(200, {})
    const res = await call('list_candidates', { page: 0 })
    expect(res.status).toBe(400)
    expect(((await res.json()) as { code: string }).code).toBe('invalid_argument')
    expect(mock).not.toHaveBeenCalled()
  })

  it('schema 里路径参数是 optional,但缺它拼不出路径 → 400 且不打上游', async () => {
    const mock = mockRecruitcrm(200, {})
    const res = await call('get_job', {})
    expect(res.status).toBe(400)
    expect(((await res.json()) as { message: string }).message).toContain('job')
    expect(mock).not.toHaveBeenCalled()
  })

  it('上游错误按状态归一', async () => {
    mockRecruitcrm(401, { message: 'Unauthenticated' })
    const denied = await call('list_candidates', {})
    expect(denied.status).toBe(401)
    await expect(denied.json()).resolves.toMatchObject({
      code: 'permission_denied',
      message: 'Unauthenticated',
    })

    mockRecruitcrm(429, { error: 'Rate limit exceeded' })
    await expect((await call('list_candidates', {})).json())
      .resolves.toMatchObject({ code: 'rate_limited', retryable: true })

    mockRecruitcrm(404, { detail: 'Candidate not found' })
    await expect((await call('get_candidate', { candidate: 'missing' })).json())
      .resolves.toMatchObject({ code: 'not_found', message: 'Candidate not found' })

    mockRecruitcrm(500, { message: 'Recruit CRM is down' })
    await expect((await call('list_candidates', {})).json())
      .resolves.toMatchObject({ code: 'unavailable', retryable: true })
  })

  it('没配 authRef → unavailable 且不打上游', async () => {
    const mock = mockRecruitcrm(200, {})
    const res = await call('list_candidates', {}, { auth: null })
    expect(res.status).toBe(503)
    expect(((await res.json()) as { message: string }).message).toContain('authRef')
    expect(mock).not.toHaveBeenCalled()
  })
})
