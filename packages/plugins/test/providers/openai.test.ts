import {
  base64urlEncode,
  type CallContext,
  encodeCallContext,
  HEADER_TB_CONTEXT,
  HEADER_TB_UPSTREAM_AUTH,
} from '@tool-bridge/core'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createOpenaiPlugin } from '../../src/openai/index'
import { openaiActions } from '../../src/openai/schema'

/**
 * OpenAI 迁移产物的 wire 级验收。重点在几个"迁移最容易迁丢"的地方:
 * 流式拦截、multipart 音频上传(含数组字段的 `[]` 后缀)、base64 往返、
 * 非 JSON 响应的兜底,以及错误归一。
 */

const PLUGIN_TOKEN = 'tbp_test'
const ENV = { PLUGIN_TOKEN }
const API_KEY = 'sk-proj-deadbeef'
const plugin = createOpenaiPlugin()

const CALLER: CallContext = {
  keyId: 'k1',
  owner: 'agent:tester',
  scopes: [],
  traceId: 't1',
  mountPath: 'ai/openai',
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

function mockOpenai(status: number, payload: unknown): ReturnType<typeof vi.fn> {
  const fn = vi.fn(() => Promise.resolve(new Response(JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json' },
  })))
  vi.stubGlobal('fetch', fn)
  return fn
}

/** 取上游收到的第 n 个请求(音频动作会先拉源文件,再打 OpenAI)。 */
function sent(mock: ReturnType<typeof vi.fn>, index = 0): Request {
  return (mock.mock.calls[index] as [Request])[0]
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('契约面', () => {
  it('List 出全部 15 个 action,且都带 Zod 派生的 schema', async () => {
    const res = await envelope({ tool: 'List', arguments: {} })
    const tools = (await res.json()) as Array<{ inputSchema?: unknown, name: string, outputSchema?: unknown }>
    expect(tools).toHaveLength(Object.keys(openaiActions).length)
    expect(tools).toHaveLength(15)
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
    expect(effectOf('get_batch')).toBe('read')
    expect(effectOf('create_response')).toBe('write')
    expect(effectOf('cancel_batch')).toBe('destructive')
  })
})

describe('JSON 接口', () => {
  it('create_response:POST /v1/responses,Bearer 凭证,入参原样进 body', async () => {
    const mock = mockOpenai(200, { id: 'resp_1', output: [] })
    await call('create_response', {
      model: 'gpt-4.1',
      input: 'hello',
      temperature: 0.5,
      metadata: { tenant: 'acme' },
    })

    const request = sent(mock)
    expect(request.url).toBe('https://api.openai.com/v1/responses')
    expect(request.method).toBe('POST')
    expect(request.headers.get('authorization')).toBe(`Bearer ${API_KEY}`)
    expect(request.headers.get('content-type')).toBe('application/json')
    await expect(request.json()).resolves.toEqual({
      model: 'gpt-4.1',
      input: 'hello',
      temperature: 0.5,
      metadata: { tenant: 'acme' },
    })
  })

  it('list_input_items:路径参数被编码,query 逐项展开,数组重复同名键', async () => {
    const mock = mockOpenai(200, { data: [] })
    await call('list_input_items', {
      response_id: 'resp/1',
      after: 'item_9',
      include: ['a', 'b'],
      limit: 5,
      order: 'desc',
    })

    const url = new URL(sent(mock).url)
    expect(url.pathname).toBe('/v1/responses/resp%2F1/input_items')
    expect(url.searchParams.getAll('include')).toEqual(['a', 'b'])
    expect(url.searchParams.get('after')).toBe('item_9')
    expect(url.searchParams.get('limit')).toBe('5')
    expect(url.searchParams.get('order')).toBe('desc')
    expect(sent(mock).method).toBe('GET')
  })

  it('cancel_batch 是 POST,list_models 是 GET 且不带 body', async () => {
    const cancel = mockOpenai(200, { id: 'batch_1' })
    await call('cancel_batch', { batch_id: 'batch_1' })
    expect(sent(cancel).url).toBe('https://api.openai.com/v1/batches/batch_1/cancel')
    expect(sent(cancel).method).toBe('POST')

    vi.unstubAllGlobals()
    const list = mockOpenai(200, { object: 'list', data: [] })
    await call('list_models', {})
    expect(sent(list).url).toBe('https://api.openai.com/v1/models')
    expect(sent(list).method).toBe('GET')
    expect(sent(list).body).toBeNull()
  })
})

describe('音频与二进制', () => {
  it('create_speech:音频字节转 base64,content-type 取自响应头', async () => {
    const audio = new Uint8Array([0, 1, 2, 250, 255])
    const mock = vi.fn(() => Promise.resolve(new Response(audio, {
      status: 200,
      headers: { 'content-type': 'audio/mpeg; charset=binary' },
    })))
    vi.stubGlobal('fetch', mock)

    const res = await call('create_speech', { model: 'gpt-4o-mini-tts', input: 'hi', voice: 'alloy' })
    expect(sent(mock).headers.get('accept')).toBe('*/*')
    await expect(res.json()).resolves.toEqual({
      content: { content_base64: 'AAEC+v8=', content_type: 'audio/mpeg' },
    })
  })

  it('create_audio_transcription:file 走 multipart,数组字段带 [] 后缀', async () => {
    const mock = mockOpenai(200, { text: 'hello world' })
    // 'aGVsbG8=' 是 "hello" 的 base64。
    await call('create_audio_transcription', {
      file: { name: 'a.mp3', content_base64: 'aGVsbG8=', mimetype: 'audio/mpeg' },
      model: 'whisper-1',
      timestamp_granularities: ['word', 'segment'],
      temperature: 0.2,
    })

    const request = sent(mock)
    expect(request.url).toBe('https://api.openai.com/v1/audio/transcriptions')
    // multipart 的 boundary 由运行时生成,手写 content-type 会让上游解不出分段。
    expect(request.headers.get('content-type')).toMatch(/^multipart\/form-data; boundary=/)
    const form = await request.formData()
    expect((form.get('file') as File).name).toBe('a.mp3')
    expect(await (form.get('file') as File).text()).toBe('hello')
    expect(form.getAll('timestamp_granularities[]')).toEqual(['word', 'segment'])
    expect(form.get('model')).toBe('whisper-1')
    expect(form.get('temperature')).toBe('0.2')
  })

  it('转写响应非 JSON 时包成 {text}', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(new Response('WEBVTT\n\n00:00.000 --> 00:01.000\nhi', {
      status: 200,
      headers: { 'content-type': 'text/vtt' },
    }))))
    const res = await call('create_audio_translation', {
      file: { name: 'a.mp3', content_base64: 'aGVsbG8=' },
      model: 'whisper-1',
      response_format: 'vtt',
    })
    await expect(res.json()).resolves.toMatchObject({
      content: { text: expect.stringContaining('WEBVTT') as unknown },
    })
  })

  it('file.url 先被拉取,再作为 multipart 上传', async () => {
    const mock = vi.fn((request: Request) => Promise.resolve(
      request.url === 'https://cdn.example.com/a.mp3'
        ? new Response(new Uint8Array([1, 2, 3]), { status: 200, headers: { 'content-type': 'audio/mpeg' } })
        : new Response(JSON.stringify({ text: 'ok' }), { status: 200, headers: { 'content-type': 'application/json' } }),
    ))
    vi.stubGlobal('fetch', mock)

    await call('create_audio_transcription', {
      file: { name: 'a.mp3', url: 'https://cdn.example.com/a.mp3' },
      model: 'whisper-1',
    })
    expect(sent(mock, 0).url).toBe('https://cdn.example.com/a.mp3')
    expect(sent(mock, 1).url).toBe('https://api.openai.com/v1/audio/transcriptions')
  })
})

describe('校验与错误', () => {
  it('入参校验真的生效:temperature 越界 → 400 且不打上游', async () => {
    const mock = mockOpenai(200, {})
    const res = await call('create_response', { model: 'gpt-4.1', input: 'hi', temperature: 9 })
    expect(res.status).toBe(400)
    expect(((await res.json()) as { code: string }).code).toBe('invalid_argument')
    expect(mock).not.toHaveBeenCalled()
  })

  it('stream=true 在本地就挡下(连接器不消费 SSE)', async () => {
    const mock = mockOpenai(200, {})
    const res = await call('create_response', { model: 'gpt-4.1', input: 'hi', stream: true })
    expect(res.status).toBe(400)
    expect(((await res.json()) as { message: string }).message).toContain('stream=true')
    expect(mock).not.toHaveBeenCalled()
  })

  it('file 的 url/content_base64 二选一:都给、都不给都 400 且不打上游', async () => {
    const both = mockOpenai(200, {})
    const resBoth = await call('create_audio_translation', {
      file: { name: 'a.mp3', url: 'https://cdn.example.com/a.mp3', content_base64: 'aGVsbG8=' },
      model: 'whisper-1',
    })
    expect(resBoth.status).toBe(400)
    expect(((await resBoth.json()) as { message: string }).message).toContain('only one of')
    expect(both).not.toHaveBeenCalled()

    vi.unstubAllGlobals()
    const neither = mockOpenai(200, {})
    const resNeither = await call('create_audio_translation', {
      file: { name: 'a.mp3' },
      model: 'whisper-1',
    })
    expect(resNeither.status).toBe(400)
    expect(((await resNeither.json()) as { message: string }).message).toContain('is required')
    expect(neither).not.toHaveBeenCalled()
  })

  it('content_base64 不是合法 base64 → 400 且不打上游', async () => {
    const mock = mockOpenai(200, {})
    const res = await call('create_audio_translation', {
      file: { name: 'a.mp3', content_base64: '!!!not base64!!!' },
      model: 'whisper-1',
    })
    expect(res.status).toBe(400)
    expect(((await res.json()) as { message: string }).message).toContain('valid base64')
    expect(mock).not.toHaveBeenCalled()
  })

  it('上游错误按状态归一,消息取自 error.message', async () => {
    mockOpenai(401, { error: { message: 'Incorrect API key provided' } })
    const unauthorized = await call('list_models', {})
    expect(unauthorized.status).toBe(401)
    await expect(unauthorized.json()).resolves.toMatchObject({
      code: 'permission_denied',
      message: 'Incorrect API key provided',
    })

    vi.unstubAllGlobals()
    mockOpenai(429, { error: { message: 'Rate limit reached' } })
    await expect((await call('list_models', {})).json())
      .resolves.toMatchObject({ code: 'rate_limited', retryable: true })

    vi.unstubAllGlobals()
    // 上游把 404 压成 400;迁移后交回 upstreamError 统一归一,404 仍是 not_found。
    mockOpenai(404, { error: { message: 'The model does not exist' } })
    await expect((await call('get_model', { model: 'nope' })).json())
      .resolves.toMatchObject({ code: 'not_found' })

    vi.unstubAllGlobals()
    mockOpenai(500, { error: { message: 'server error' } })
    await expect((await call('list_models', {})).json())
      .resolves.toMatchObject({ code: 'unavailable', retryable: true })
  })

  it('传输层失败归一成 unavailable,而不是漏成插件内部错误', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('ECONNREFUSED'))))
    await expect((await call('list_models', {})).json())
      .resolves.toMatchObject({ code: 'unavailable', message: expect.stringContaining('ECONNREFUSED') as unknown })
  })

  it('没配 authRef → unavailable 且不打上游', async () => {
    const mock = mockOpenai(200, {})
    const res = await call('list_models', {}, { auth: null })
    expect(res.status).toBe(503)
    expect(((await res.json()) as { message: string }).message).toContain('authRef')
    expect(mock).not.toHaveBeenCalled()
  })
})
