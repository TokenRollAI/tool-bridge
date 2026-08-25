import {
  type CallContext,
} from '@tool-bridge/core'
import { describe, expect, it, vi } from 'vitest'
import { z } from 'zod/v4'
import { createProviderHarness } from '../support/providerHarness'
import { createMemosPlugin } from '../../src/memos/index'
import { memosActions } from '../../src/memos/schema'

/**
 * Memos 迁移产物的 wire 级验收。重点钉住几个"迁移最容易迁丢"的地方:
 * `baseUrl` 归一(补 `/api/v1`、去 query、拒内网与带凭证的 URL)、AIP 资源名的**路径穿越**
 * 闸门、`update_memo` 的 field mask(按键在不在算、snake_case 转名、`location: null` 是抹掉)、
 * `upload_attachment` 的"取回再转发 + 20 MiB 上限 + base64"、以及分页 token 缺席时的 `null`。
 */

const API_KEY = 'memos_pat_deadbeef'
const BASE = 'https://memos.example.com'
const plugin = createMemosPlugin()

function caller(mountConfig?: Record<string, unknown>): CallContext {
  return {
    keyId: 'k1',
    owner: 'agent:tester',
    scopes: [],
    traceId: 't1',
    mountPath: 'notes/memos',
    exportId: 'actions',
    ...(mountConfig === undefined ? {} : { mountConfig }),
  }
}

interface CallOptions {
  auth?: string | null
  config?: Record<string, unknown>
}

const { call, envelope, sent, sentUrl, stubFetch } = createProviderHarness<CallOptions>({
  caller: opts => caller(opts.config === undefined ? { baseUrl: BASE } : opts.config),
  mountPath: 'notes/memos',
  plugin,
  upstreamAuth: API_KEY,
})

interface Reply {
  /** 原始体;传 `null` 表示无体(204 必须这么给,`''` 在 undici 下直接 TypeError)。 */
  body?: null | string
  /** 字节体。字符串体会被 undici 自动补上 `content-type: text/plain`,验"没有 MIME"时要用它。 */
  bytes?: Uint8Array
  headers?: Record<string, string>
  payload?: unknown
  status?: number
}

/** 按顺序回应出站请求(`upload_attachment` 先下载 fileUrl,再打 Memos)。 */
function mockReplies(...replies: Reply[]): ReturnType<typeof vi.fn> {
  const queue = [...replies]
  return stubFetch(() => {
    const reply = queue.shift() ?? { payload: {} }
    // `bytes` 走 Uint8Array,但本仓的 DOM lib 里 `BodyInit` 不含它(只认 ArrayBuffer /
    // ArrayBufferView 的部分子集),故取它的 buffer 交出去 —— 运行期等价。
    const body: BodyInit | null = reply.bytes !== undefined
      ? (reply.bytes.buffer as ArrayBuffer)
      : (reply.body === undefined ? JSON.stringify(reply.payload ?? {}) : reply.body)
    return Promise.resolve(new Response(body, {
      status: reply.status ?? 200,
      headers: reply.headers ?? { 'content-type': 'application/json' },
    }))
  })
}

const MEMO = { name: 'memos/abc', content: 'hello', visibility: 'PRIVATE' }

describe('契约面', () => {
  it('~describe 报成单个 tools/v1 export,并带上凭证探针', async () => {
    const res = await createMemosPlugin().fetch(new Request('https://plugin.test/~describe'), {} as never)
    await expect(res.json()).resolves.toEqual({
      protocolVersion: 'plugin/v2',
      exports: [{
        auth: { kind: 'single', required: true },
        id: 'actions',
        profile: 'tools/v1',
        description: 'Memos',
        credentialProbe: 'get_current_user',
        mountConfigFields: [{
          key: 'baseUrl',
          label: '实例地址',
          description: '你的 Memos 实例地址,如 https://memos.example.com',
          required: true,
        }],
      }],
    })
  })

  it('探针 get_current_user 只读且无必填入参(平台挂载时会空参调它)', () => {
    const spec = memosActions.get_current_user
    expect(spec.effect).toBe('read')
    const schema = z.toJSONSchema(spec.inputSchema, { io: 'input' }) as { required?: string[] }
    expect(schema.required ?? []).toEqual([])
  })

  it('List 出全部 14 个 action,且都带 Zod 派生的 schema', async () => {
    const res = await envelope({ tool: 'List', arguments: {} })
    const tools = (await res.json()) as Array<{ inputSchema?: unknown, name: string, outputSchema?: unknown }>
    expect(tools).toHaveLength(Object.keys(memosActions).length)
    expect(tools).toHaveLength(14)
    expect(tools.map(tool => tool.name).sort()).toEqual([
      'create_memo',
      'delete_attachment',
      'delete_memo',
      'get_attachment',
      'get_current_user',
      'get_memo',
      'get_user',
      'list_attachments',
      'list_memo_attachments',
      'list_memos',
      'list_users',
      'set_memo_attachments',
      'update_memo',
      'upload_attachment',
    ])
    for (const tool of tools) {
      expect(tool.inputSchema, `${tool.name} 缺 inputSchema`).toBeDefined()
      expect(tool.outputSchema, `${tool.name} 缺 outputSchema`).toBeDefined()
    }
  })
})

describe('baseUrl 归一', () => {
  it('自动补 /api/v1,凭证走 authorization 头', async () => {
    const mock = mockReplies({ payload: { memo: MEMO } })
    await call('get_memo', { name: 'memos/abc' })
    expect(sent(mock).url).toBe('https://memos.example.com/api/v1/memos/abc')
    expect(sent(mock).headers.get('authorization')).toBe(`Bearer ${API_KEY}`)
  })

  it('已经带 /api/v1 的不重复补;末尾斜杠、query、hash 都去掉', async () => {
    const mock = mockReplies({ payload: MEMO })
    await call('get_memo', { name: 'memos/abc' }, { config: { baseUrl: `${BASE}/api/v1/?x=1#f` } })
    expect(sent(mock).url).toBe('https://memos.example.com/api/v1/memos/abc')
  })

  it('反代在子路径下的实例:上下文路径保住,再补 /api/v1', async () => {
    const mock = mockReplies({ payload: MEMO })
    await call('get_memo', { name: 'memos/abc' }, { config: { baseUrl: `${BASE}/memos` } })
    expect(sent(mock).url).toBe('https://memos.example.com/memos/api/v1/memos/abc')
  })

  it('http 的 baseUrl 放行(上游明确支持 HTTP 或 HTTPS)', async () => {
    const mock = mockReplies({ payload: MEMO })
    const res = await call('get_memo', { name: 'memos/abc' }, { config: { baseUrl: 'http://memos.example.com' } })
    expect(res.status).toBe(200)
    expect(sent(mock).url).toBe('http://memos.example.com/api/v1/memos/abc')
  })

  it('没配 baseUrl → invalid_argument,消息指向要配什么,且不打上游', async () => {
    const mock = mockReplies({ payload: MEMO })
    const res = await call('get_memo', { name: 'memos/abc' }, { config: {} })
    expect(res.status).toBe(400)
    const body = (await res.json()) as { code: string, message: string }
    expect(body.code).toBe('invalid_argument')
    expect(body.message).toContain('providerConfig.baseUrl')
    expect(mock).not.toHaveBeenCalled()
  })

  it('指向内网的 baseUrl 被拒,消息说清"必须公网可达"', async () => {
    const mock = mockReplies({ payload: MEMO })
    const res = await call('get_memo', { name: 'memos/abc' }, { config: { baseUrl: 'https://192.168.1.9:5230' } })
    expect(res.status).toBe(400)
    expect(((await res.json()) as { message: string }).message).toContain('公网可达')
    expect(mock).not.toHaveBeenCalled()
  })

  it('baseUrl 里带用户名/密码被拒(那会把凭证漏进日志)', async () => {
    const mock = mockReplies({ payload: MEMO })
    const res = await call('get_memo', { name: 'memos/abc' }, { config: { baseUrl: 'https://u:p@memos.example.com' } })
    expect(res.status).toBe(400)
    expect(((await res.json()) as { message: string }).message).toContain('用户名/密码')
    expect(mock).not.toHaveBeenCalled()
  })
})

describe('资源名与路径穿越', () => {
  it('`memos/../users/1` 这类名字被挡下,不会拼进 URL', async () => {
    const mock = mockReplies({ payload: MEMO })
    const res = await call('get_memo', { name: 'memos/../users/1' })
    expect(res.status).toBe(400)
    await expect(res.json()).resolves.toMatchObject({
      code: 'invalid_argument',
      message: 'name must use the memos/{id} resource format',
    })
    expect(mock).not.toHaveBeenCalled()
  })

  it('集合名对不上也被挡下(拿 users/1 去调 get_memo)', async () => {
    const mock = mockReplies({ payload: MEMO })
    const res = await call('get_memo', { name: 'users/1' })
    expect(res.status).toBe(400)
    expect(mock).not.toHaveBeenCalled()
  })

  it('id 段被 encodeURIComponent,不越出资源边界', async () => {
    const mock = mockReplies({ payload: MEMO })
    await call('get_memo', { name: 'memos/a b' })
    expect(sentUrl(mock).pathname).toBe('/api/v1/memos/a%20b')
  })

  it('set_memo_attachments 的每个附件名都先校验,坏名字一个也别发出去', async () => {
    const mock = mockReplies({ payload: {} })
    const res = await call('set_memo_attachments', {
      name: 'memos/abc',
      attachmentNames: ['attachments/ok1', 'attachments/../../etc/passwd'],
    })
    expect(res.status).toBe(400)
    expect(mock).not.toHaveBeenCalled()
  })
})

describe('请求拼装', () => {
  it('create_memo:memoId 走 query,其余进 body', async () => {
    const mock = mockReplies({ payload: MEMO })
    await call('create_memo', {
      content: 'hello',
      visibility: 'PUBLIC',
      memoId: 'my-id',
      pinned: true,
      location: { placeholder: 'Tokyo', latitude: 35.68, longitude: 139.69 },
    })

    const request = sent(mock)
    expect(request.method).toBe('POST')
    expect(new URL(request.url).pathname).toBe('/api/v1/memos')
    expect(Object.fromEntries(new URL(request.url).searchParams)).toEqual({ memoId: 'my-id' })
    expect(request.headers.get('content-type')).toBe('application/json')
    await expect(request.json()).resolves.toEqual({
      content: 'hello',
      visibility: 'PUBLIC',
      pinned: true,
      location: { placeholder: 'Tokyo', latitude: 35.68, longitude: 139.69 },
    })
  })

  it('list_memos:分页与过滤参数进 query,不给的不出现', async () => {
    const mock = mockReplies({ payload: { memos: [], nextPageToken: '' } })
    await call('list_memos', { pageSize: 20, state: 'ARCHIVED', filter: 'tag in ["work"]', showDeleted: false })
    expect(Object.fromEntries(sentUrl(mock).searchParams)).toEqual({
      pageSize: '20',
      state: 'ARCHIVED',
      filter: 'tag in ["work"]',
      // false 要发出去(它与"不过滤"不是一回事)。
      showDeleted: 'false',
    })
  })

  it('update_memo:updateMask 按给了哪些键算,名字转成 snake_case', async () => {
    const mock = mockReplies({ payload: MEMO })
    await call('update_memo', { name: 'memos/abc', content: 'new', createTime: '2024-01-01T00:00:00+00:00' })

    const request = sent(mock)
    expect(request.method).toBe('PATCH')
    expect(new URL(request.url).pathname).toBe('/api/v1/memos/abc')
    expect(new URL(request.url).searchParams.get('updateMask')).toBe('content,create_time')
    await expect(request.json()).resolves.toEqual({
      name: 'memos/abc',
      content: 'new',
      createTime: '2024-01-01T00:00:00+00:00',
    })
  })

  it('update_memo:显式给 location: null 表示抹掉位置 —— mask 里要有它,body 里的 null 要留住', async () => {
    const mock = mockReplies({ payload: MEMO })
    await call('update_memo', { name: 'memos/abc', location: null })
    expect(sentUrl(mock).searchParams.get('updateMask')).toBe('location')
    await expect(sent(mock).json()).resolves.toEqual({ name: 'memos/abc', location: null })
  })

  it('update_memo:一个可改字段都不给 → invalid_argument 且不打上游(schema 的 refine)', async () => {
    const mock = mockReplies({ payload: MEMO })
    const res = await call('update_memo', { name: 'memos/abc' })
    expect(res.status).toBe(400)
    expect(((await res.json()) as { code: string }).code).toBe('invalid_argument')
    expect(mock).not.toHaveBeenCalled()
  })

  it('update_memo:mask 顺序按固定清单来,不随入参键序漂', async () => {
    const mock = mockReplies({ payload: MEMO })
    await call('update_memo', { name: 'memos/abc', pinned: true, state: 'NORMAL', content: 'x' })
    expect(sentUrl(mock).searchParams.get('updateMask')).toBe('content,pinned,state')
  })

  it('delete_memo:force 进 query,回 {deleted, name};204 空体也当成功', async () => {
    const mock = mockReplies({ status: 204, body: null })
    const res = await call('delete_memo', { name: 'memos/abc', force: true })
    expect(sent(mock).method).toBe('DELETE')
    expect(sentUrl(mock).searchParams.get('force')).toBe('true')
    await expect(res.json()).resolves.toEqual({ content: { deleted: true, name: 'memos/abc' } })
  })

  it('set_memo_attachments:整集合替换,body 是 {name, attachments:[{name}]}', async () => {
    const mock = mockReplies({ payload: {} })
    const res = await call('set_memo_attachments', {
      name: 'memos/abc',
      attachmentNames: ['attachments/a1', 'attachments/a2'],
    })

    const request = sent(mock)
    expect(request.method).toBe('PATCH')
    expect(new URL(request.url).pathname).toBe('/api/v1/memos/abc/attachments')
    await expect(request.json()).resolves.toEqual({
      name: 'memos/abc',
      attachments: [{ name: 'attachments/a1' }, { name: 'attachments/a2' }],
    })
    await expect(res.json()).resolves.toEqual({
      content: { updated: true, name: 'memos/abc', attachmentNames: ['attachments/a1', 'attachments/a2'] },
    })
  })

  it('set_memo_attachments:空数组是"清空所有附件",要发出去', async () => {
    const mock = mockReplies({ payload: {} })
    await call('set_memo_attachments', { name: 'memos/abc', attachmentNames: [] })
    await expect(sent(mock).json()).resolves.toEqual({ name: 'memos/abc', attachments: [] })
  })

  it('list_memo_attachments 打 memo 的子集合;get_user 的 readMask 进 query', async () => {
    const attachments = mockReplies({ payload: { attachments: [] } })
    await call('list_memo_attachments', { name: 'memos/abc', pageSize: 5 })
    expect(sentUrl(attachments).pathname).toBe('/api/v1/memos/abc/attachments')

    vi.unstubAllGlobals()
    const user = mockReplies({ payload: { name: 'users/1' } })
    await call('get_user', { name: 'users/1', readMask: 'username,email' })
    expect(sentUrl(user).pathname).toBe('/api/v1/users/1')
    expect(sentUrl(user).searchParams.get('readMask')).toBe('username,email')
  })

  it('GET 不带 content-type,也没有请求体', async () => {
    const mock = mockReplies({ payload: { user: { name: 'users/1' } } })
    await call('get_current_user', {})
    expect(sentUrl(mock).pathname).toBe('/api/v1/auth/me')
    expect(sent(mock).headers.get('content-type')).toBeNull()
    expect(await sent(mock).text()).toBe('')
  })
})

describe('upload_attachment', () => {
  it('先按 fileUrl 下载(不带 Memos 凭证),再把 base64 塞进 Memos 的 body', async () => {
    const mock = mockReplies(
      { body: 'hi', headers: { 'content-type': 'image/png; charset=binary' } },
      { payload: { name: 'attachments/a1', filename: 'x.png' } },
    )
    const res = await call('upload_attachment', {
      fileUrl: 'https://cdn.example.com/x.png',
      filename: 'x.png',
      attachmentId: 'a1',
      memo: 'memos/abc',
    })

    const download = sent(mock, 0)
    expect(download.url).toBe('https://cdn.example.com/x.png')
    // 这一跳打的是第三方地址,绝不能带上 Memos 的 PAT。
    expect(download.headers.get('authorization')).toBeNull()

    const upload = sent(mock, 1)
    expect(new URL(upload.url).pathname).toBe('/api/v1/attachments')
    expect(new URL(upload.url).searchParams.get('attachmentId')).toBe('a1')
    await expect(upload.json()).resolves.toEqual({
      filename: 'x.png',
      // 'hi' 的 base64;MIME 从响应头取,`; charset=...` 那段要切掉。
      content: 'aGk=',
      type: 'image/png',
      memo: 'memos/abc',
    })
    await expect(res.json()).resolves.toEqual({
      content: { attachment: { name: 'attachments/a1', filename: 'x.png' } },
    })
  })

  it('入参给了 type 就用它,不看响应头', async () => {
    const mock = mockReplies({ body: 'hi', headers: { 'content-type': 'text/plain' } }, { payload: {} })
    await call('upload_attachment', {
      fileUrl: 'https://cdn.example.com/x.bin',
      filename: 'x.bin',
      type: 'application/pdf',
    })
    await expect(sent(mock, 1).json()).resolves.toMatchObject({ type: 'application/pdf' })
  })

  it('响应头也没有 content-type 时兜底 application/octet-stream', async () => {
    const mock = mockReplies({ bytes: new Uint8Array([104, 105]), headers: {} }, { payload: {} })
    await call('upload_attachment', { fileUrl: 'https://cdn.example.com/x', filename: 'x' })
    await expect(sent(mock, 1).json()).resolves.toMatchObject({ content: 'aGk=', type: 'application/octet-stream' })
  })

  it('content-length 就超过 20 MiB 时当场拒,不下载也不上传', async () => {
    const mock = mockReplies({
      body: 'hi',
      headers: { 'content-length': String(21 * 1024 * 1024) },
    }, { payload: {} })
    const res = await call('upload_attachment', { fileUrl: 'https://cdn.example.com/big', filename: 'big' })
    expect(res.status).toBe(400)
    await expect(res.json()).resolves.toMatchObject({ code: 'invalid_argument' })
    // 下载那一跳发了(要读头),但 Memos 那一跳不该发。
    expect(mock).toHaveBeenCalledTimes(1)
  })

  it('fileUrl 指向内网 → invalid_argument(SSRF 闸门),Memos 那一跳不发', async () => {
    const mock = mockReplies({ body: 'hi' }, { payload: {} })
    const res = await call('upload_attachment', { fileUrl: 'https://169.254.169.254/latest/meta-data', filename: 'x' })
    expect(res.status).toBe(400)
    expect(((await res.json()) as { code: string }).code).toBe('invalid_argument')
    expect(mock).not.toHaveBeenCalled()
  })

  it('fileUrl 下载失败(4xx)→ unavailable,不把它说成参数错', async () => {
    const mock = mockReplies({ status: 404, body: 'nope' }, { payload: {} })
    const res = await call('upload_attachment', { fileUrl: 'https://cdn.example.com/gone', filename: 'x' })
    await expect(res.json()).resolves.toMatchObject({ code: 'unavailable', retryable: true })
    expect(mock).toHaveBeenCalledTimes(1)
  })
})

describe('响应整形', () => {
  it('列表:nextPageToken 缺席或空串都给 null,memos 键缺席补成空数组', async () => {
    mockReplies({ payload: { memos: [MEMO] } })
    await expect((await call('list_memos', {})).json()).resolves.toEqual({
      content: { memos: [MEMO], nextPageToken: null },
    })

    vi.unstubAllGlobals()
    mockReplies({ payload: { nextPageToken: 'tok' } })
    await expect((await call('list_memos', {})).json()).resolves.toEqual({
      content: { memos: [], nextPageToken: 'tok' },
    })
  })

  it('列表项不是对象 → unavailable + retryable(上游形状不符契约)', async () => {
    mockReplies({ payload: { memos: ['nope'] } })
    const res = await call('list_memos', {})
    expect(res.status).toBe(503)
    await expect(res.json()).resolves.toMatchObject({ code: 'unavailable', retryable: true })
  })

  it('get_current_user 从 user 信封里取(上游就是这么读的)', async () => {
    mockReplies({ payload: { user: { name: 'users/1', username: 'sasha' } } })
    await expect((await call('get_current_user', {})).json()).resolves.toEqual({
      content: { user: { name: 'users/1', username: 'sasha' } },
    })

    vi.unstubAllGlobals()
    // 没有 user 信封就是形状不符契约,报 unavailable 而不是回半个结果。
    mockReplies({ payload: { name: 'users/1' } })
    const res = await call('get_current_user', {})
    expect(res.status).toBe(503)
    await expect(res.json()).resolves.toMatchObject({ code: 'unavailable' })
  })
})

describe('校验与错误', () => {
  it('入参校验真的生效:pageSize 越界 → 400 且不打上游', async () => {
    const mock = mockReplies({ payload: {} })
    const res = await call('list_memos', { pageSize: 5000 })
    expect(res.status).toBe(400)
    expect(((await res.json()) as { code: string }).code).toBe('invalid_argument')
    expect(mock).not.toHaveBeenCalled()
  })

  it('4xx 按原始状态归一:404 not_found、403 permission_denied、409 conflict', async () => {
    mockReplies({ status: 404, payload: { message: 'memo not found' } })
    const missing = await call('get_memo', { name: 'memos/zzz' })
    expect(missing.status).toBe(404)
    await expect(missing.json()).resolves.toMatchObject({ code: 'not_found', message: 'memo not found' })

    vi.unstubAllGlobals()
    mockReplies({ status: 403, payload: { message: 'not your memo' } })
    const denied = await call('delete_memo', { name: 'memos/abc' })
    expect(denied.status).toBe(403)
    await expect(denied.json()).resolves.toMatchObject({ code: 'permission_denied' })

    vi.unstubAllGlobals()
    mockReplies({ status: 409, payload: { message: 'memoId taken' } })
    const conflict = await call('create_memo', { content: 'x', memoId: 'dup' })
    expect(conflict.status).toBe(409)
    await expect(conflict.json()).resolves.toMatchObject({ code: 'conflict' })
  })

  it('401 → permission_denied,429 → rate_limited(可重试),5xx → unavailable(可重试)', async () => {
    mockReplies({ status: 401, payload: { message: 'invalid token' } })
    const denied = await call('list_memos', {})
    expect(denied.status).toBe(401)
    await expect(denied.json()).resolves.toMatchObject({ code: 'permission_denied', message: 'invalid token' })

    vi.unstubAllGlobals()
    mockReplies({ status: 429, payload: { message: 'slow down' } })
    await expect((await call('list_memos', {})).json())
      .resolves.toMatchObject({ code: 'rate_limited', retryable: true })

    vi.unstubAllGlobals()
    mockReplies({ status: 502, body: '<html>bad gateway</html>' })
    await expect((await call('list_memos', {})).json())
      .resolves.toMatchObject({ code: 'unavailable', retryable: true, message: '<html>bad gateway</html>' })
  })

  it('2xx 上回非 JSON → unavailable(上游坏了),而不是 internal 500', async () => {
    mockReplies({ status: 200, body: 'not json' })
    const res = await call('get_memo', { name: 'memos/abc' })
    expect(res.status).toBe(503)
    await expect(res.json()).resolves.toMatchObject({ code: 'unavailable', message: 'Memos returned invalid JSON' })
  })

  it('传输层失败归一成 unavailable,而不是冒成 internal 500', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new TypeError('socket hang up'))))
    const res = await call('list_memos', {})
    expect(res.status).toBe(503)
    await expect(res.json()).resolves.toMatchObject({ code: 'unavailable', retryable: true })
  })

  it('没配 authRef → unavailable 且不打上游', async () => {
    const mock = mockReplies({ payload: {} })
    const res = await call('list_memos', {}, { auth: null })
    expect(res.status).toBe(503)
    expect(((await res.json()) as { message: string }).message).toContain('authRef')
    expect(mock).not.toHaveBeenCalled()
  })
})
