import { describe, expect, it, vi } from 'vitest'
import { createProviderHarness } from '../support/providerHarness'
import { createMistralAiPlugin } from '../../src/mistral_ai/index'
import { mistralAiActions } from '../../src/mistral_ai/schema'

/**
 * Mistral AI 迁移产物的 wire 级验收。54 个 action 共用一张规格表,所以重点不在逐个测,
 * 而在**规格表的每一类分支**:路径参数替换、GET 把剩余入参全当 query、写方法只提
 * queryKeys、bodyOnDelete 的 DELETE 带 body、multipart 上传、以及两处 transit file 依赖的拒绝。
 */

const API_KEY = 'mistral_test_key'
const plugin = createMistralAiPlugin()

const {
  call,
  envelope,
  sent,
  stubFetch,
} = createProviderHarness({
  mountPath: 'ai/mistral',
  plugin,
  upstreamAuth: API_KEY,
})

function mockMistral(status: number, payload: unknown): ReturnType<typeof vi.fn> {
  return stubFetch(() => Promise.resolve(new Response(status === 204 ? null : JSON.stringify(payload), {
    status,
    headers: status === 204 ? {} : { 'content-type': 'application/json' },
  })))
}

describe('契约面', () => {
  it('List 出全部 54 个 action,且都带 Zod 派生的 schema', async () => {
    const res = await envelope({ tool: 'List', arguments: {} })
    const tools = (await res.json()) as Array<{ inputSchema?: unknown, name: string, outputSchema?: unknown }>
    expect(tools).toHaveLength(Object.keys(mistralAiActions).length)
    expect(tools).toHaveLength(54)
    for (const tool of tools) {
      expect(tool.inputSchema, `${tool.name} 缺 inputSchema`).toBeDefined()
      expect(tool.outputSchema, `${tool.name} 缺 outputSchema`).toBeDefined()
    }
  })

  it('effect 播种值符合读写语义', async () => {
    const res = await envelope({ tool: 'List', arguments: {} })
    const tools = (await res.json()) as Array<{ effect?: string, name: string }>
    const effectOf = (name: string): string | undefined => tools.find(t => t.name === name)?.effect
    expect(effectOf('list_models')).toBe('read')
    expect(effectOf('create_chat_completion')).toBe('write')
    expect(effectOf('delete_agent')).toBe('destructive')
    expect(effectOf('delete_library_share')).toBe('destructive')
  })
})

describe('规格表:路径与 query', () => {
  it('零参 GET:凭证走 Bearer,响应原样透出', async () => {
    const mock = mockMistral(200, { object: 'list', data: [{ id: 'mistral-small' }] })
    const res = await call('list_models', {})

    const request = sent(mock)
    expect(request.method).toBe('GET')
    expect(request.url).toBe('https://api.mistral.ai/v1/models')
    expect(request.headers.get('authorization')).toBe(`Bearer ${API_KEY}`)
    await expect(res.json()).resolves.toEqual({
      content: { object: 'list', data: [{ id: 'mistral-small' }] },
    })
  })

  it('pathKeys 替换进路径模板并被 URL 编码', async () => {
    const mock = mockMistral(200, { id: 'a/b' })
    await call('get_model', { model_id: 'a/b' })
    expect(sent(mock).url).toBe('https://api.mistral.ai/v1/models/a%2Fb')
  })

  it('两个 pathKeys 都替换(库文档端点)', async () => {
    const mock = mockMistral(200, {})
    await call('get_document_status', { library_id: 'lib1', document_id: 'doc1' })
    expect(new URL(sent(mock).url).pathname)
      .toBe('/v1/libraries/lib1/documents/doc1/status')
  })

  it('GET 把剩余全部入参当 query,对象参数序列化成 JSON 串', async () => {
    const mock = mockMistral(200, {})
    await call('list_conversations', { page: 2, page_size: 50, metadata: { team: 'growth' } })
    const url = new URL(sent(mock).url)
    expect(url.pathname).toBe('/v1/conversations')
    expect(url.searchParams.get('page')).toBe('2')
    expect(url.searchParams.get('page_size')).toBe('50')
    expect(url.searchParams.get('metadata')).toBe('{"team":"growth"}')
  })

  it('GET 的数组参数重复同名键', async () => {
    const mock = mockMistral(200, {})
    await call('list_agents', { sources: ['a', 'b'] })
    expect(new URL(sent(mock).url).searchParams.getAll('sources')).toEqual(['a', 'b'])
  })
})

describe('规格表:请求体', () => {
  it('POST 把剩余入参发成 JSON body', async () => {
    const mock = mockMistral(200, { id: 'cmpl_1' })
    await call('create_chat_completion', {
      model: 'mistral-small',
      messages: [{ role: 'user', content: 'hi' }],
      temperature: 0.2,
    })

    const request = sent(mock)
    expect(request.method).toBe('POST')
    expect(request.url).toBe('https://api.mistral.ai/v1/chat/completions')
    expect(request.headers.get('content-type')).toBe('application/json')
    await expect(request.json()).resolves.toEqual({
      model: 'mistral-small',
      messages: [{ role: 'user', content: 'hi' }],
      temperature: 0.2,
    })
  })

  it('写方法只把 queryKeys 提成 query,path 参数不重复进 body', async () => {
    const mock = mockMistral(200, {})
    await call('create_or_update_agent_alias', { agent_id: 'ag1', alias: 'prod', version: 3 })

    const request = sent(mock)
    expect(request.method).toBe('PUT')
    const url = new URL(request.url)
    expect(url.pathname).toBe('/v1/agents/ag1/aliases')
    expect(url.searchParams.get('alias')).toBe('prod')
    expect(url.searchParams.get('version')).toBe('3')
    // queryKeys 与 pathKeys 都被摘走,body 里什么都不剩。
    await expect(request.json()).resolves.toEqual({})
  })

  it('不带 bodyOnDelete 的 DELETE 把剩余入参当 query', async () => {
    const mock = mockMistral(204, null)
    const res = await call('delete_conversation', { conversation_id: 'conv1' })
    const request = sent(mock)
    expect(request.method).toBe('DELETE')
    expect(request.url).toBe('https://api.mistral.ai/v1/conversations/conv1')
    // 204 无体 → 归一成 {deleted:true}。
    await expect(res.json()).resolves.toEqual({ content: { deleted: true } })
  })

  it('bodyOnDelete 的 DELETE 改为发 JSON body', async () => {
    const mock = mockMistral(200, { ok: true })
    await call('delete_library_share', { library_id: 'lib1', share_with_uuid: 'u1', share_with_type: 'User' })
    const request = sent(mock)
    expect(request.method).toBe('DELETE')
    expect(new URL(request.url).search).toBe('')
    await expect(request.json()).resolves.toEqual({ share_with_uuid: 'u1', share_with_type: 'User' })
  })
})

describe('multipart 上传', () => {
  it('base64 上传源被解码成 File,其余字段进 form', async () => {
    const mock = mockMistral(200, { id: 'file_1' })
    await call('upload_file', {
      file: { name: 'a.txt', mimeType: 'text/plain', content_base64: 'aGVsbG8=' },
      purpose: 'ocr',
      expiry: 24,
    })

    const request = sent(mock)
    expect(request.method).toBe('POST')
    expect(request.url).toBe('https://api.mistral.ai/v1/files')
    // multipart 请求不能带 JSON content-type,否则边界丢失。
    expect(request.headers.get('content-type')).toContain('multipart/form-data')
    const form = await request.formData()
    const file = form.get('file') as File
    expect(file.name).toBe('a.txt')
    expect(file.type).toBe('text/plain')
    await expect(file.text()).resolves.toBe('hello')
    expect(form.get('purpose')).toBe('ocr')
    expect(form.get('expiry')).toBe('24')
  })

  it('file.url 上传源先由插件拉取,再作为 File 上传', async () => {
    const fn = vi.fn((request: Request) => Promise.resolve(
      request.url === 'https://cdn.example.com/a.pdf'
        ? new Response('PDFBYTES', { status: 200, headers: { 'content-type': 'application/pdf' } })
        : new Response(JSON.stringify({ id: 'doc_1' }), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          }),
    ))
    vi.stubGlobal('fetch', fn)

    await call('upload_library_document', {
      library_id: 'lib1',
      file: { name: 'a.pdf', url: 'https://cdn.example.com/a.pdf' },
    })

    expect(fn).toHaveBeenCalledTimes(2)
    expect(sent(fn, 0).url).toBe('https://cdn.example.com/a.pdf')
    const upload = sent(fn, 1)
    expect(new URL(upload.url).pathname).toBe('/v1/libraries/lib1/documents')
    const file = (await upload.formData()).get('file') as File
    await expect(file.text()).resolves.toBe('PDFBYTES')
  })

  it('file.fileId(transit file)不可用 → 400 且不打上游', async () => {
    const mock = mockMistral(200, {})
    const res = await call('upload_file', { file: { fileId: 'tf_1' } })
    expect(res.status).toBe(400)
    expect(((await res.json()) as { message: string }).message).toContain('transit file')
    expect(mock).not.toHaveBeenCalled()
  })

  it('音频转写用 file_id 时只发 file_id,不拉文件', async () => {
    const mock = mockMistral(200, { text: 'hello' })
    await call('create_audio_transcription', {
      model: 'voxtral-mini-latest',
      file_id: 'file_1',
      timestamp_granularities: ['segment', 'word'],
    })
    expect(mock).toHaveBeenCalledTimes(1)
    const form = await sent(mock).formData()
    expect(form.get('file_id')).toBe('file_1')
    expect(form.has('file')).toBe(false)
    expect(form.getAll('timestamp_granularities')).toEqual(['segment', 'word'])
  })

  it('音频转写的 file.url 交给 Mistral 去拉,先过公网校验', async () => {
    const mock = mockMistral(200, { text: 'hi' })
    await call('create_audio_transcription', {
      model: 'voxtral-mini-latest',
      file: { name: 'a.mp3', url: 'https://cdn.example.com/a.mp3' },
    })
    // 只打一次:URL 是转交给上游的,不由插件下载。
    expect(mock).toHaveBeenCalledTimes(1)
    const form = await sent(mock).formData()
    expect(form.get('file_url')).toBe('https://cdn.example.com/a.mp3')
    expect(form.has('file')).toBe(false)
  })

  it('音频转写的 file.url 指向内网 → 400 且不打上游(转发型 SSRF)', async () => {
    const mock = mockMistral(200, {})
    const res = await call('create_audio_transcription', {
      model: 'voxtral-mini-latest',
      file: { name: 'a.mp3', url: 'http://169.254.169.254/meta' },
    })
    expect(res.status).toBe(400)
    expect(((await res.json()) as { message: string }).message).toContain('公网')
    expect(mock).not.toHaveBeenCalled()
  })

  it('音频转写同时给 file_id 与 file.url → 400 且不打上游', async () => {
    const mock = mockMistral(200, {})
    const res = await call('create_audio_transcription', {
      model: 'voxtral-mini-latest',
      file_id: 'file_1',
      file: { name: 'a.mp3', url: 'https://cdn.example.com/a.mp3' },
    })
    expect(res.status).toBe(400)
    expect(((await res.json()) as { message: string }).message).toContain('only one of')
    expect(mock).not.toHaveBeenCalled()
  })
})

describe('校验与错误', () => {
  it('入参校验生效:temperature 超界 → 400 且不打上游', async () => {
    const mock = mockMistral(200, {})
    const res = await call('create_chat_completion', {
      model: 'mistral-small',
      messages: [{ role: 'user', content: 'hi' }],
      temperature: 9,
    })
    expect(res.status).toBe(400)
    expect(((await res.json()) as { code: string }).code).toBe('invalid_argument')
    expect(mock).not.toHaveBeenCalled()
  })

  it('stream=true 被本地拒绝(这条链路不转发 SSE)', async () => {
    const mock = mockMistral(200, {})
    const res = await call('create_chat_completion', {
      model: 'mistral-small',
      messages: [{ role: 'user', content: 'hi' }],
      stream: true,
    })
    expect(res.status).toBe(400)
    expect(((await res.json()) as { message: string }).message).toContain('stream=true')
    expect(mock).not.toHaveBeenCalled()
  })

  it('download_file 需要本地 transit 存储,当前显式拒绝', async () => {
    const mock = mockMistral(200, {})
    const res = await call('download_file', { file_id: 'file_1' })
    expect(res.status).toBe(501)
    await expect(res.json()).resolves.toMatchObject({ code: 'unavailable' })
    expect(mock).not.toHaveBeenCalled()
  })

  it('上游错误按状态归一,消息取自 detail/message', async () => {
    mockMistral(401, { message: 'Unauthorized' })
    await expect((await call('list_models', {})).json())
      .resolves.toMatchObject({ code: 'permission_denied', message: 'Unauthorized' })

    mockMistral(429, { detail: 'Rate limit exceeded' })
    await expect((await call('list_models', {})).json())
      .resolves.toMatchObject({ code: 'rate_limited', retryable: true, message: 'Rate limit exceeded' })

    mockMistral(422, { detail: 'model is required' })
    await expect((await call('list_models', {})).json())
      .resolves.toMatchObject({ code: 'invalid_argument', message: 'model is required' })

    mockMistral(404, { message: 'No such model' })
    await expect((await call('get_model', { model_id: 'nope' })).json())
      .resolves.toMatchObject({ code: 'not_found' })

    mockMistral(500, { message: 'boom' })
    await expect((await call('list_models', {})).json())
      .resolves.toMatchObject({ code: 'unavailable', retryable: true })
  })

  it('没配 authRef → 503 且不打上游', async () => {
    const mock = mockMistral(200, {})
    const res = await call('list_models', {}, { auth: null })
    expect(res.status).toBe(503)
    expect(((await res.json()) as { message: string }).message).toContain('authRef')
    expect(mock).not.toHaveBeenCalled()
  })
})
