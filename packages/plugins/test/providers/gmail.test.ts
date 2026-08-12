import {
  base64urlDecode,
  base64urlEncode,
  type CallContext,
  encodeCallContext,
  HEADER_TB_CONTEXT,
  HEADER_TB_UPSTREAM_AUTH,
} from '@tool-bridge/core'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createGmailPlugin } from '../../src/gmail/index'
import { gmailActions } from '../../src/gmail/schema'

/**
 * Gmail 迁移产物的 wire 级验收。重点在几个"迁移最容易迁丢"的地方:
 * OAuth 声明面(少一个 authorizationParams 就永远拿不到 refresh_token)、
 * MIME 组装(收件人合并、引号内逗号、subject 编码)、`update_draft` 的"给了空串 vs 没给"、
 * filters 列表那个单数字段名、以及 403 的两种含义。
 */

const PLUGIN_TOKEN = 'tbp_test'
const ENV = { PLUGIN_TOKEN }
/** 平台托管 OAuth2 换来的 access token —— 插件侧与一个 API key 没有区别。 */
const ACCESS_TOKEN = 'ya29.a0Ahtestdeadbeef'
const plugin = createGmailPlugin()

const CALLER: CallContext = {
  keyId: 'k1',
  owner: 'agent:tester',
  scopes: [],
  traceId: 't1',
  mountPath: 'mail/gmail',
  exportId: 'actions',
}

function envelope(body: unknown, opts: { auth?: string | null } = {}): Promise<Response> {
  const headers: Record<string, string> = {
    'authorization': `Bearer ${PLUGIN_TOKEN}`,
    'content-type': 'application/json',
    [HEADER_TB_CONTEXT]: encodeCallContext(CALLER),
  }
  const auth = opts.auth === undefined ? ACCESS_TOKEN : opts.auth
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

/**
 * 按调用顺序回一串响应(最后一个会被复用)。Gmail 的好几个 action 是"列表 + 逐个详情",
 * 顺序敏感,单个固定响应测不出来。
 */
function mockGmail(...responses: Array<{ body?: unknown, status?: number }>): ReturnType<typeof vi.fn> {
  let index = 0
  const fn = vi.fn(() => {
    const next = responses[Math.min(index, responses.length - 1)] ?? {}
    index += 1
    const status = next.status ?? 200
    // 204 必须传 null:`new Response('', {status:204})` 在 undici 下直接 TypeError。
    const body = status === 204 || next.body === undefined ? null : JSON.stringify(next.body)
    return Promise.resolve(new Response(body, { status, headers: { 'content-type': 'application/json' } }))
  })
  vi.stubGlobal('fetch', fn)
  return fn
}

function sent(mock: ReturnType<typeof vi.fn>, index = 0): Request {
  return (mock.mock.calls[index] as [Request])[0]
}

function url(mock: ReturnType<typeof vi.fn>, index = 0): URL {
  return new URL(sent(mock, index).url)
}

async function jsonBody(request: Request): Promise<Record<string, unknown>> {
  return (await request.json()) as Record<string, unknown>
}

function encodeBase64Url(value: string): string {
  return base64urlEncode(new TextEncoder().encode(value))
}

function decodeBase64(value: string): string {
  const binary = atob(value)
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index)
  return new TextDecoder().decode(bytes)
}

/** 把 `raw` 拆回头部行与正文(正文在 MIME 里是 base64 的)。 */
function mime(raw: unknown): { body: string, headers: string[] } {
  const text = new TextDecoder().decode(base64urlDecode(String(raw)))
  const separator = text.indexOf('\r\n\r\n')
  const head = text.slice(0, separator)
  const body = text.slice(separator + 4)
  return { headers: head.split('\r\n'), body: body === '' ? '' : decodeBase64(body) }
}

/** 一封带头部与纯文本正文的消息资源(format=full 的形状)。 */
function messageResource(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'm1',
    threadId: 't1',
    labelIds: ['INBOX', 'UNREAD'],
    internalDate: '1700000000000',
    snippet: 'hello there',
    payload: {
      mimeType: 'text/plain',
      headers: [
        { name: 'Subject', value: 'Quarterly review' },
        { name: 'From', value: 'Ada <ada@example.com>' },
        { name: 'To', value: 'me@example.com' },
        { name: 'Date', value: 'Tue, 14 Nov 2023 22:13:20 +0000' },
        { name: 'Message-ID', value: '<abc@mail.example.com>' },
      ],
      body: { data: encodeBase64Url('full body text') },
    },
    ...overrides,
  }
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('契约面', () => {
  it('List 出全部 46 个 action,且都带 Zod 派生的 schema', async () => {
    const res = await envelope({ tool: 'List', arguments: {} })
    const tools = (await res.json()) as Array<{ inputSchema?: unknown, name: string, outputSchema?: unknown }>
    expect(tools).toHaveLength(Object.keys(gmailActions).length)
    expect(tools).toHaveLength(46)
    for (const tool of tools) {
      expect(tool.inputSchema, `${tool.name} 缺 inputSchema`).toBeDefined()
      expect(tool.outputSchema, `${tool.name} 缺 outputSchema`).toBeDefined()
    }
  })

  it('~describe 报单个 tools/v1 export,oauth 端点与 scope 与上游逐字一致', async () => {
    const res = await plugin.fetch(new Request('https://plugin.test/~describe'), ENV as never)
    const body = (await res.json()) as {
      exports: Array<{
        credentialFields?: unknown
        credentialProbe?: unknown
        oauth?: {
          authorizationParams?: Record<string, string>
          authorizationUrl?: string
          scopes?: string[]
          tokenUrl?: string
        }
        profile?: string
      }>
    }
    expect(body.exports).toHaveLength(1)
    const [export0] = body.exports
    expect(export0?.profile).toBe('tools/v1')
    expect(export0?.oauth?.authorizationUrl).toBe('https://accounts.google.com/o/oauth2/v2/auth')
    expect(export0?.oauth?.tokenUrl).toBe('https://oauth2.googleapis.com/token')
    expect(export0?.oauth?.scopes).toEqual([
      'https://www.googleapis.com/auth/gmail.readonly',
      'https://www.googleapis.com/auth/gmail.modify',
      'https://www.googleapis.com/auth/gmail.compose',
      'https://www.googleapis.com/auth/gmail.send',
      'https://www.googleapis.com/auth/gmail.labels',
      'https://www.googleapis.com/auth/gmail.settings.basic',
    ])
    // 这两个参数少一个,Google 就不下发 refresh_token,令牌一过期只能手工重新授权。
    expect(export0?.oauth?.authorizationParams).toEqual({ access_type: 'offline', prompt: 'consent' })
    // 与 oauth 互斥,声明了就装配失败 —— 这里钉住"确实没声明"。
    expect(export0?.credentialProbe).toBeUndefined()
    expect(export0?.credentialFields).toBeUndefined()
  })
})

describe('请求拼装', () => {
  it('凭证走 Authorization: Bearer,GET 不发 content-type 也不发请求体', async () => {
    const mock = mockGmail({ body: { labels: [] } })
    await call('list_labels', {})
    const request = sent(mock)
    expect(request.method).toBe('GET')
    expect(request.headers.get('authorization')).toBe(`Bearer ${ACCESS_TOKEN}`)
    expect(request.headers.get('content-type')).toBeNull()
    expect(await request.text()).toBe('')
    expect(url(mock).toString()).toBe('https://gmail.googleapis.com/gmail/v1/users/me/labels')
  })

  it('入参里的 userId 一律忽略:URL 恒为 users/me,请求体里也不带它', async () => {
    const mock = mockGmail({ body: { id: 'Label_1', name: 'Ops', type: 'user' } })
    await call('create_label', { name: 'Ops', userId: 'someone-else@example.com' })
    expect(url(mock).pathname).toBe('/gmail/v1/users/me/labels')
    await expect(jsonBody(sent(mock))).resolves.toEqual({ name: 'Ops' })
  })

  it('fetch_emails:labelIds 展开成重复的同名参数,maxResults 缺省补 20', async () => {
    const mock = mockGmail(
      { body: { messages: [{ id: 'm1', threadId: 't1' }], resultSizeEstimate: 1 } },
      { body: messageResource() },
    )
    await call('fetch_emails', { query: '  is:unread  ', labelIds: ['INBOX', 'IMPORTANT'] })
    const listUrl = url(mock)
    expect(listUrl.pathname).toBe('/gmail/v1/users/me/messages')
    expect(listUrl.searchParams.getAll('labelIds')).toEqual(['INBOX', 'IMPORTANT'])
    // query 去空白后才发;maxResults 是 fetch_emails 独有的默认值。
    expect(listUrl.searchParams.get('q')).toBe('is:unread')
    expect(listUrl.searchParams.get('maxResults')).toBe('20')
    expect(listUrl.searchParams.get('includeSpamTrash')).toBeNull()
  })

  it('fetch_emails 的三档 detail 决定详情请求的 format,ids 档一次详情都不打', async () => {
    const list = { body: { messages: [{ id: 'm1', threadId: 't1' }, { id: 'm2', threadId: 't2' }] } }

    const ids = mockGmail(list)
    const idsRes = await call('fetch_emails', { detail: 'ids' })
    expect(ids).toHaveBeenCalledTimes(1)
    await expect(idsRes.json()).resolves.toEqual({
      content: {
        messages: [
          { messageId: 'm1', threadId: 't1' },
          { messageId: 'm2', threadId: 't2' },
        ],
        nextPageToken: null,
        resultSizeEstimate: 2,
      },
    })

    vi.unstubAllGlobals()
    const summary = mockGmail(list, { body: messageResource() }, { body: messageResource({ id: 'm2' }) })
    await call('fetch_emails', { detail: 'summary' })
    expect(summary).toHaveBeenCalledTimes(3)
    expect(url(summary, 1).searchParams.get('format')).toBe('metadata')
    expect(url(summary, 2).pathname).toBe('/gmail/v1/users/me/messages/m2')

    vi.unstubAllGlobals()
    const full = mockGmail(list, { body: messageResource() }, { body: messageResource({ id: 'm2' }) })
    await call('fetch_emails', { detail: 'full' })
    expect(url(full, 1).searchParams.get('format')).toBe('full')
  })

  it('list_threads 不给 maxResults 就不发这个参数(交给 Gmail 的默认值)', async () => {
    const mock = mockGmail({ body: { threads: [] } })
    await call('list_threads', {})
    expect([...url(mock).searchParams.keys()]).toEqual([])
  })

  it('thread id 的 thread-f: 前缀在打接口前剥掉', async () => {
    const mock = mockGmail({ body: { id: 't1', messages: [] } })
    await call('fetch_message_by_thread_id', { threadId: 'thread-f:t1' })
    expect(url(mock).pathname).toBe('/gmail/v1/users/me/threads/t1')
  })
})

describe('MIME 组装', () => {
  it('send_email:三处收件人字段并成一份 To,body 走 base64,凭证与 content-type 都在', async () => {
    const mock = mockGmail({ body: { id: 'sent1', threadId: 't9' } })
    const res = await call('send_email', {
      to: 'a@example.com',
      recipientEmail: 'b@example.com',
      extraRecipients: ['c@example.com', '  '],
      cc: ['cc@example.com'],
      bcc: 'bcc@example.com',
      subject: 'Weekly sync',
      body: 'See you at 10.',
    })

    const request = sent(mock)
    expect(request.method).toBe('POST')
    expect(request.headers.get('content-type')).toBe('application/json')
    expect(url(mock).pathname).toBe('/gmail/v1/users/me/messages/send')

    const body = await jsonBody(request)
    // 发新信不带 threadId,否则 Gmail 会把它挂到别的会话上。
    expect(Object.keys(body)).toEqual(['raw'])
    const { body: text, headers } = mime(body.raw)
    expect(headers).toEqual([
      'To: a@example.com, b@example.com, c@example.com',
      'Cc: cc@example.com',
      'Bcc: bcc@example.com',
      'Subject: Weekly sync',
      'MIME-Version: 1.0',
      'Content-Type: text/plain; charset=UTF-8',
      'Content-Transfer-Encoding: base64',
    ])
    expect(text).toBe('See you at 10.')
    await expect(res.json()).resolves.toEqual({ content: { messageId: 'sent1' } })
  })

  it('非 ASCII 的 subject 走 RFC 2047 的 B 编码,isHtml 换 Content-Type', async () => {
    const mock = mockGmail({ body: { id: 'sent2' } })
    await call('send_email', { to: 'a@example.com', subject: '周报', body: '<b>hi</b>', isHtml: true })
    const { headers } = mime((await jsonBody(sent(mock))).raw)
    expect(headers).toContain('Subject: =?UTF-8?B?5ZGo5oql?=')
    expect(headers).toContain('Content-Type: text/html; charset=UTF-8')
  })

  it('reply_email:主题加一次 Re:,线程锚点取原信的 Message-ID,threadId 跟着发', async () => {
    const mock = mockGmail({ body: messageResource() }, { body: { id: 'sent3', threadId: 't1' } })
    const res = await call('reply_email', { messageId: 'm1', threadId: 'thread-f:t1', body: 'Sounds good.' })

    expect(url(mock, 0).searchParams.get('format')).toBe('full')
    const body = await jsonBody(sent(mock, 1))
    expect(body.threadId).toBe('t1')
    const { body: text, headers } = mime(body.raw)
    expect(headers).toEqual([
      // 取的是完整的第一个地址项(含 display name),而不是剥出来的裸邮箱。
      'To: Ada <ada@example.com>',
      'Subject: Re: Quarterly review',
      'In-Reply-To: <abc@mail.example.com>',
      'References: <abc@mail.example.com>',
      'MIME-Version: 1.0',
      'Content-Type: text/plain; charset=UTF-8',
      'Content-Transfer-Encoding: base64',
    ])
    expect(text).toBe('Sounds good.')
    // 上游内层算出了 threadId 却在外层丢掉;出参声明里也没有它,保持一致。
    await expect(res.json()).resolves.toEqual({ content: { messageId: 'sent3' } })
  })

  it('reply_to_thread:回最后一封,主题由原信决定(入参的 subject 不参与)', async () => {
    const mock = mockGmail(
      {
        body: {
          id: 't1',
          messages: [
            messageResource({ id: 'm1' }),
            messageResource({
              id: 'm2',
              payload: {
                headers: [
                  { name: 'Subject', value: 'Re: Quarterly review' },
                  { name: 'From', value: 'bob@example.com' },
                  { name: 'Reply-To', value: '"Doe, John" <john@example.com>, other@example.com' },
                  { name: 'Message-ID', value: '<second@mail.example.com>' },
                ],
              },
            }),
          ],
        },
      },
      { body: { id: 'sent4', threadId: 't1' } },
    )
    await call('reply_to_thread', { threadId: 't1', subject: '我改的主题', messageBody: 'ack' })

    const { headers } = mime((await jsonBody(sent(mock, 1))).raw)
    // Reply-To 优先于 From,且只取第一个地址 —— 引号内的逗号不是地址分隔符。
    expect(headers).toContain('To: "Doe, John" <john@example.com>')
    // 已经带 Re: 的主题不再叠一层,入参的 subject 被忽略(改主题会把会话断开)。
    expect(headers).toContain('Subject: Re: Quarterly review')
    expect(headers).not.toContain('Subject: 我改的主题')
  })

  it('空会话回复不了:归 invalid_argument 且不发信', async () => {
    const mock = mockGmail({ body: { id: 't1', messages: [] } })
    const res = await call('reply_to_thread', { threadId: 't1', body: 'hi' })
    expect(res.status).toBe(400)
    await expect(res.json()).resolves.toMatchObject({ code: 'invalid_argument' })
    expect(mock).toHaveBeenCalledTimes(1)
  })
})

describe('update_draft 的就地合并', () => {
  const existingDraft = {
    id: 'r1',
    message: {
      id: 'm1',
      threadId: 't1',
      payload: {
        mimeType: 'text/plain',
        headers: [
          { name: 'To', value: '"Doe, John" <john@example.com>, b@example.com' },
          { name: 'Cc', value: 'cc@example.com' },
          { name: 'Subject', value: 'Old subject' },
          { name: 'From', value: 'Me <me@example.com>' },
        ],
        body: { data: encodeBase64Url('old body') },
      },
    },
  }

  it('只改主题:收件人、正文、发信别名全从原草稿回填(引号内的逗号不切开)', async () => {
    const mock = mockGmail({ body: existingDraft }, { body: { id: 'r1', message: { id: 'm2', threadId: 't1' } } })
    const res = await call('update_draft', { draftId: 'r1', subject: 'New subject' })

    expect(sent(mock, 1).method).toBe('PUT')
    expect(url(mock, 1).pathname).toBe('/gmail/v1/users/me/drafts/r1')
    const body = await jsonBody(sent(mock, 1))
    expect(body.id).toBe('r1')
    const message = body.message as Record<string, unknown>
    expect(message.threadId).toBe('t1')
    const { body: text, headers } = mime(message.raw)
    expect(headers).toContain('From: Me <me@example.com>')
    expect(headers).toContain('To: "Doe, John" <john@example.com>, b@example.com')
    expect(headers).toContain('Cc: cc@example.com')
    expect(headers).toContain('Subject: New subject')
    expect(text).toBe('old body')
    await expect(res.json()).resolves.toEqual({
      content: { draftId: 'r1', messageId: 'm2', threadId: 't1' },
    })
  })

  it('显式给空正文就真的清空 —— "给了空串"与"没提这个字段"必须分开', async () => {
    const mock = mockGmail({ body: existingDraft }, { body: { id: 'r1', message: {} } })
    const res = await call('update_draft', { draftId: 'r1', body: '' })
    const body = await jsonBody(sent(mock, 1))
    expect(mime((body.message as Record<string, unknown>).raw).body).toBe('')
    expect(body.id).toBe('r1')
    // 上游回的 message 里没有 id/threadId 时用空串占位(出参声明里它们是 string)。
    await expect(res.json()).resolves.toEqual({
      content: { draftId: 'r1', messageId: '', threadId: '' },
    })
  })
})

describe('响应整形', () => {
  it('get_message 平铺 6 个字段,date 取原始 Date 头而不是 ISO 时间戳', async () => {
    mockGmail({ body: messageResource() })
    const res = await call('get_message', { messageId: 'm1' })
    await expect(res.json()).resolves.toEqual({
      content: {
        messageId: 'm1',
        threadId: 't1',
        subject: 'Quarterly review',
        from: 'Ada <ada@example.com>',
        to: 'me@example.com',
        date: 'Tue, 14 Nov 2023 22:13:20 +0000',
        body: 'full body text',
      },
    })
  })

  it('fetch_message_by_message_id:internalDate 换成 ISO,正文从 multipart 深处挖出来', async () => {
    mockGmail({
      body: messageResource({
        snippet: undefined,
        payload: {
          mimeType: 'multipart/alternative',
          headers: [{ name: 'Subject', value: 'Nested' }],
          parts: [
            // 空的 text/plain 占位不算找到正文,要继续往下找。
            { mimeType: 'text/plain', body: { data: '' } },
            { mimeType: 'text/html', body: { data: encodeBase64Url('<p>nested body</p>') } },
            { mimeType: 'application/pdf', filename: 'report.pdf', body: { attachmentId: 'a1', size: 1024 } },
          ],
        },
      }),
    })
    const res = await call('fetch_message_by_message_id', { messageId: 'm1' })
    await expect(res.json()).resolves.toMatchObject({
      content: {
        messageId: 'm1',
        messageTimestamp: '2023-11-14T22:13:20.000Z',
        messageText: '<p>nested body</p>',
        preview: { subject: 'Nested', body: '<p>nested body</p>' },
        attachmentList: [{ attachmentId: 'a1', filename: 'report.pdf', mimeType: 'application/pdf', size: 1024 }],
      },
    })
  })

  it('list_filters 读的是单数的 filter 字段,空列表(Gmail 回 null)折成空表', async () => {
    const withFilters = mockGmail({ body: { filter: [{ id: 'f1', criteria: { from: 'a@b.c' }, action: {} }] } })
    await expect((await call('list_filters', {})).json()).resolves.toEqual({
      content: { filters: [{ id: 'f1', criteria: { from: 'a@b.c' }, action: {} }] },
    })
    expect(url(withFilters).pathname).toBe('/gmail/v1/users/me/settings/filters')

    vi.unstubAllGlobals()
    mockGmail({ body: null })
    await expect((await call('list_filters', {})).json()).resolves.toEqual({ content: { filters: [] } })
  })

  it('list_history 没有变更时把入参的 historyId 报回去(下一轮的水位)', async () => {
    const mock = mockGmail({ body: {} })
    const res = await call('list_history', { startHistoryId: '4242', historyTypes: ['messageAdded', 'labelAdded'] })
    expect(url(mock).searchParams.getAll('historyTypes')).toEqual(['messageAdded', 'labelAdded'])
    await expect(res.json()).resolves.toEqual({
      content: { history: [], historyId: '4242', nextPageToken: null },
    })
  })

  it('204 空响应的 action 出参是 {success:true},且 DELETE 不带请求体', async () => {
    const mock = mockGmail({ status: 204 })
    const res = await call('delete_draft', { draftId: 'r1' })
    expect(sent(mock).method).toBe('DELETE')
    expect(await sent(mock).text()).toBe('')
    await expect(res.json()).resolves.toEqual({ content: { success: true } })

    vi.unstubAllGlobals()
    const batch = mockGmail({ status: 204 })
    await expect((await call('batch_modify_messages', {
      messageIds: ['m1', 'm2'],
      addLabelIds: ['STARRED'],
    })).json()).resolves.toEqual({ content: { success: true } })
    // 两个标签字段恒发(可以是空数组),不做"没给就不发"。
    await expect(jsonBody(sent(batch))).resolves.toEqual({
      ids: ['m1', 'm2'],
      addLabelIds: ['STARRED'],
      removeLabelIds: [],
    })
  })

  it('settings 各资源打各自的 URL,更新时入参即请求体', async () => {
    const get = mockGmail({ body: { enabled: true } })
    await call('settings_get_imap', {})
    expect(url(get).pathname).toBe('/gmail/v1/users/me/settings/imap')

    vi.unstubAllGlobals()
    const put = mockGmail({ body: { enabled: false } })
    await call('update_pop_settings', { accessWindow: 'allMail', userId: 'ignored@example.com' })
    expect(url(put).pathname).toBe('/gmail/v1/users/me/settings/pop')
    expect(sent(put).method).toBe('PUT')
    await expect(jsonBody(sent(put))).resolves.toEqual({ accessWindow: 'allMail' })
  })
})

describe('校验与错误', () => {
  it('入参校验真的生效:缺必填与越界都在本地拦下,不打上游', async () => {
    const missing = mockGmail({ body: {} })
    const res = await call('get_message', {})
    expect(res.status).toBe(400)
    expect(((await res.json()) as { code: string }).code).toBe('invalid_argument')
    expect(missing).not.toHaveBeenCalled()

    vi.unstubAllGlobals()
    const tooMany = mockGmail({ body: {} })
    expect((await call('fetch_emails', { maxResults: 501 })).status).toBe(400)
    expect(tooMany).not.toHaveBeenCalled()
  })

  it('上游 4xx/5xx 按状态归一,消息取自 error.message', async () => {
    mockGmail({ status: 404, body: { error: { code: 404, message: 'Requested entity was not found.' } } })
    const missing = await call('get_message', { messageId: 'nope' })
    expect(missing.status).toBe(404)
    await expect(missing.json()).resolves.toMatchObject({
      code: 'not_found',
      message: 'Requested entity was not found.',
    })

    vi.unstubAllGlobals()
    mockGmail({ status: 400, body: { error: { message: 'Invalid label id' } } })
    await expect((await call('get_label', { labelId: 'x' })).json())
      .resolves.toMatchObject({ code: 'invalid_argument', message: 'Invalid label id' })

    vi.unstubAllGlobals()
    mockGmail({ status: 503, body: { error: { message: 'Backend error' } } })
    const down = await call('get_profile', {})
    expect(down.status).toBe(503)
    await expect(down.json()).resolves.toMatchObject({ code: 'unavailable', retryable: true })
  })

  it('403 的两种含义分开:配额耗尽可重试,权限不足不可重试', async () => {
    mockGmail({
      status: 403,
      body: {
        error: {
          code: 403,
          message: 'User-rate limit exceeded.',
          errors: [{ reason: 'userRateLimitExceeded', domain: 'usageLimits' }],
        },
      },
    })
    const limited = await call('get_profile', {})
    expect(limited.status).toBe(429)
    await expect(limited.json()).resolves.toMatchObject({
      code: 'rate_limited',
      retryable: true,
      message: 'User-rate limit exceeded.',
    })

    vi.unstubAllGlobals()
    mockGmail({
      status: 403,
      body: {
        error: {
          code: 403,
          message: 'Request had insufficient authentication scopes.',
          errors: [{ reason: 'insufficientPermissions' }],
        },
      },
    })
    const forbidden = await call('get_profile', {})
    expect(forbidden.status).toBe(403)
    await expect(forbidden.json()).resolves.toMatchObject({ code: 'permission_denied' })
  })

  it('上游回的形状不符契约 → unavailable 且标 retryable(而不是伪装成调用方的错)', async () => {
    mockGmail({ body: { threadId: 't1' } })
    const res = await call('get_message', { messageId: 'm1' })
    expect(res.status).toBe(503)
    await expect(res.json()).resolves.toMatchObject({ code: 'unavailable', retryable: true })
  })

  it('没配 authRef → unavailable 且不打上游(不能拿空 Bearer 去试)', async () => {
    const mock = mockGmail({ body: {} })
    const res = await call('get_profile', {}, { auth: null })
    expect(res.status).toBe(503)
    expect(((await res.json()) as { message: string }).message).toContain('authRef')
    expect(mock).not.toHaveBeenCalled()
  })
})
