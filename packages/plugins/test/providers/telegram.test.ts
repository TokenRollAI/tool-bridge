import { describe, expect, it, vi } from 'vitest'
import { createProviderHarness } from '../support/providerHarness'
import { createTelegramPlugin } from '../../src/telegram/index'
import { telegramActions } from '../../src/telegram/schema'

/**
 * Telegram 迁移产物的 wire 级验收。重点钉住几个"迁移最容易迁丢"的地方:
 * bot token 进 URL 路径段(以及畸形 token 会改写路径)、HTTP 200 + `ok:false` 的信封式错误、
 * 扁平入参到嵌套 Bot API 字段的转换、message_ids 的递增约束、以及编辑 inline message 时
 * 上游只回 `true` 的那条分支。
 */

const BOT_TOKEN = '123456789:AAHdeadbeef'
const plugin = createTelegramPlugin()

const {
  call,
  envelope,
  sent,
  env: ENV,
  stubFetch,
} = createProviderHarness({
  mountPath: 'chat/telegram',
  plugin,
  upstreamAuth: BOT_TOKEN,
})

/** 原样返回给定 body —— 信封式错误、非 JSON 响应这类用它。 */
function mockRaw(payload: unknown, status = 200, contentType = 'application/json'): ReturnType<typeof vi.fn> {
  const body = typeof payload === 'string' ? payload : JSON.stringify(payload)
  return stubFetch(() => Promise.resolve(new Response(body, {
    status,
    headers: { 'content-type': contentType },
  })))
}

/** Bot API 的成功信封:`{ ok: true, result }`。 */
function mockTelegram(result: unknown, opts: { status?: number } = {}): ReturnType<typeof vi.fn> {
  return mockRaw({ ok: true, result }, opts.status ?? 200)
}

async function sentBody(mock: ReturnType<typeof vi.fn>): Promise<unknown> {
  return JSON.parse(await sent(mock).text())
}

describe('契约面', () => {
  it('~describe 报单个 tools/v1 export', async () => {
    const res = await plugin.fetch(new Request('https://plugin.test/~describe'), ENV as never)
    const body = (await res.json()) as { exports: Array<{ id: string, profile: string }> }
    expect(body.exports).toHaveLength(1)
    expect(body.exports[0]?.profile).toBe('tools/v1')
    expect(body.exports[0]?.id).toBe('actions')
  })

  it('List 出全部 50 个 action,且都带 Zod 派生的 schema', async () => {
    const res = await envelope({ tool: 'List', arguments: {} })
    const tools = (await res.json()) as Array<{ inputSchema?: unknown, name: string, outputSchema?: unknown }>
    expect(tools).toHaveLength(Object.keys(telegramActions).length)
    expect(tools).toHaveLength(50)
    for (const tool of tools) {
      expect(tool.inputSchema, `${tool.name} 缺 inputSchema`).toBeDefined()
      expect(tool.outputSchema, `${tool.name} 缺 outputSchema`).toBeDefined()
    }
  })

  it('credentialProbe 选的是 get_me:read + 空入参,平台空参调得动', () => {
    expect(telegramActions.get_me.effect).toBe('read')
    expect(Object.keys(telegramActions.get_me.inputSchema.shape)).toEqual([])
  })
})

describe('请求拼装', () => {
  it('bot token 拼在 URL 路径段里(不是 header),method 是最后一段', async () => {
    const mock = mockTelegram({ id: 7, is_bot: true, first_name: 'Bot', username: 'test_bot' })
    await call('get_me', {})

    const request = sent(mock)
    const url = new URL(request.url)
    expect(url.origin).toBe('https://api.telegram.org')
    expect(url.pathname).toBe(`/bot${BOT_TOKEN}/getMe`)
    // 没有请求体的 action 走 GET,凭证不在任何 header 上。
    expect(request.method).toBe('GET')
    expect(request.headers.get('authorization')).toBeNull()
    expect(await request.text()).toBe('')
  })

  it('send_message:扁平入参转成 Bot API 的嵌套字段,未给的可选参数不出现在 body 里', async () => {
    const mock = mockTelegram({ message_id: 11, date: 1, chat: { id: -100, type: 'supergroup' }, text: 'hi' })
    const res = await call('send_message', {
      chatId: '@my_channel',
      text: 'hi',
      parseMode: 'HTML',
      replyToMessageId: 9,
      disableWebPagePreview: true,
    })

    const request = sent(mock)
    expect(request.method).toBe('POST')
    expect(new URL(request.url).pathname).toBe(`/bot${BOT_TOKEN}/sendMessage`)
    expect(request.headers.get('content-type')).toBe('application/json')
    await expect(sentBody(mock)).resolves.toEqual({
      chat_id: '@my_channel',
      text: 'hi',
      parse_mode: 'HTML',
      reply_parameters: { message_id: 9 },
      link_preview_options: { is_disabled: true },
    })
    await expect(res.json()).resolves.toMatchObject({
      content: { messageId: 11, text: 'hi', chat: { id: -100, type: 'supergroup' } },
    })
  })

  it('disableWebPagePreview 为 false 时不发 link_preview_options(只有 true 才是显式关闭)', async () => {
    const mock = mockTelegram({ message_id: 1, date: 1, chat: { id: 1, type: 'private' } })
    await call('send_message', { chatId: 1, text: 'x', disableWebPagePreview: false })
    await expect(sentBody(mock)).resolves.toEqual({ chat_id: 1, text: 'x' })
  })

  it('权限对象转成 snake_case,没给的权限不发(保持"不改动"而非置 false)', async () => {
    const mock = mockTelegram(true)
    await call('set_chat_permissions', {
      chatId: -100123,
      permissions: { canSendMessages: true, canSendPolls: false },
    })
    await expect(sentBody(mock)).resolves.toEqual({
      chat_id: -100123,
      permissions: { can_send_messages: true, can_send_polls: false },
    })
  })

  it('reply_markup 收 JSON 字符串时解码成对象再发', async () => {
    const mock = mockTelegram({ message_id: 2, date: 1, chat: { id: 1, type: 'private' } })
    await call('send_document', {
      chatId: 1,
      document: 'BQACAgIfileid',
      replyMarkup: '{"inline_keyboard":[[{"text":"go","url":"https://example.com"}]]}',
    })
    await expect(sentBody(mock)).resolves.toEqual({
      chat_id: 1,
      document: 'BQACAgIfileid',
      reply_markup: { inline_keyboard: [[{ text: 'go', url: 'https://example.com' }]] },
    })
  })

  it('get_chat_members_count 打的是 getChatMemberCount(上游方法名是单数,别跟着 action 名改)', async () => {
    const mock = mockTelegram(42)
    const res = await call('get_chat_members_count', { chatId: -100 })
    expect(new URL(sent(mock).url).pathname).toBe(`/bot${BOT_TOKEN}/getChatMemberCount`)
    await expect(res.json()).resolves.toEqual({ content: { memberCount: 42 } })
  })
})

describe('媒体与 URL', () => {
  it('file_id 原样透传,公网 URL 过出站校验后归一', async () => {
    const fileId = mockTelegram({ message_id: 3, date: 1, chat: { id: 1, type: 'private' } })
    await call('send_photo', { chatId: 1, photo: 'AgACAgIfileid' })
    await expect(sentBody(fileId)).resolves.toMatchObject({ photo: 'AgACAgIfileid' })

    vi.unstubAllGlobals()
    const url = mockTelegram({ message_id: 4, date: 1, chat: { id: 1, type: 'private' } })
    await call('send_photo', { chatId: 1, photo: 'https://example.com/a.png' })
    await expect(sentBody(url)).resolves.toMatchObject({ photo: 'https://example.com/a.png' })
  })

  it('指向内网的媒体 URL 被出站防线拦下,且不打上游', async () => {
    const mock = mockTelegram({})
    const res = await call('send_photo', { chatId: 1, photo: 'http://169.254.169.254/latest/meta-data' })
    expect(res.status).toBe(400)
    await expect(res.json()).resolves.toMatchObject({ code: 'invalid_argument' })
    expect(mock).not.toHaveBeenCalled()
  })

  it('set_webhook 的地址同样过出站校验(Telegram 会主动回访它)', async () => {
    const blocked = mockTelegram(true)
    const res = await call('set_webhook', { url: 'http://127.0.0.1/hook' })
    expect(res.status).toBe(400)
    expect(blocked).not.toHaveBeenCalled()

    vi.unstubAllGlobals()
    const ok = mockTelegram(true)
    await expect(call('set_webhook', { url: 'https://example.com/hook', dropPendingUpdates: true })
      .then(r => r.json())).resolves.toEqual({ content: { success: true } })
    await expect(sentBody(ok)).resolves.toEqual({
      url: 'https://example.com/hook',
      drop_pending_updates: true,
    })
  })
})

describe('信封式错误(HTTP 200 也可能是失败)', () => {
  it('ok:false 不当成功返回,按 error_code 归一', async () => {
    mockRaw({ ok: false, error_code: 403, description: 'Forbidden: bot was blocked by the user' })
    const res = await call('send_message', { chatId: 1, text: 'x' })
    // HTTP 是 200,但信封说失败 —— 要归到 error_code 上,不能返回成功。
    expect(res.status).toBe(403)
    await expect(res.json()).resolves.toMatchObject({
      code: 'permission_denied',
      message: 'Forbidden: bot was blocked by the user',
    })
  })

  it('429 带上 parameters.retry_after,消息里保留建议等待时间', async () => {
    mockRaw({
      ok: false,
      error_code: 429,
      description: 'Too Many Requests: retry later',
      parameters: { retry_after: 17 },
    })
    const res = await call('send_message', { chatId: 1, text: 'x' })
    expect(res.status).toBe(429)
    await expect(res.json()).resolves.toMatchObject({
      code: 'rate_limited',
      retryable: true,
      message: 'Too Many Requests: retry later Retry after 17 seconds.',
    })
  })

  it('上游 4xx → invalid_argument,5xx → unavailable + retryable', async () => {
    mockRaw({ ok: false, error_code: 400, description: 'Bad Request: chat not found' }, 400)
    const bad = await call('send_message', { chatId: 1, text: 'x' })
    expect(bad.status).toBe(400)
    await expect(bad.json()).resolves.toMatchObject({
      code: 'invalid_argument',
      message: 'Bad Request: chat not found',
    })

    vi.unstubAllGlobals()
    mockRaw({ ok: false, error_code: 502, description: 'Bad Gateway' }, 502)
    await expect((await call('send_message', { chatId: 1, text: 'x' })).json())
      .resolves.toMatchObject({ code: 'unavailable', retryable: true })
  })

  it('非 JSON 响应(网关 HTML 错误页)按 HTTP 状态归一,而不是报"响应不是 JSON"', async () => {
    mockRaw('<html>504 Gateway Time-out</html>', 504, 'text/html')
    const res = await call('get_me', {})
    await expect(res.json()).resolves.toMatchObject({ code: 'unavailable', retryable: true })
  })

  it('ok:true 但没有 result 是上游破契约 → unavailable', async () => {
    mockRaw({ ok: true })
    const res = await call('get_me', {})
    await expect(res.json()).resolves.toMatchObject({ code: 'unavailable', retryable: true })
  })
})

describe('校验与凭证', () => {
  it('入参校验真的生效:text 超长 → 400 且不打上游', async () => {
    const mock = mockTelegram({})
    const res = await call('send_message', { chatId: 1, text: 'x'.repeat(4097) })
    expect(res.status).toBe(400)
    expect(((await res.json()) as { code: string }).code).toBe('invalid_argument')
    expect(mock).not.toHaveBeenCalled()
  })

  it('message_ids 必须严格递增(schema 表达不了顺序,漏了就是一次必然失败的出站)', async () => {
    const mock = mockTelegram([])
    const res = await call('copy_messages', { chatId: 1, fromChatId: 2, messageIds: [5, 3] })
    expect(res.status).toBe(400)
    await expect(res.json()).resolves.toMatchObject({ message: 'messageIds must be in strictly increasing order' })
    expect(mock).not.toHaveBeenCalled()

    vi.unstubAllGlobals()
    const ok = mockTelegram([{ message_id: 7 }, { message_id: 8 }])
    await expect(call('copy_messages', { chatId: 1, fromChatId: 2, messageIds: [3, 5], removeCaption: true })
      .then(r => r.json())).resolves.toEqual({ content: { messageIds: [7, 8] } })
    await expect(sentBody(ok)).resolves.toEqual({
      chat_id: 1,
      from_chat_id: 2,
      message_ids: [3, 5],
      remove_caption: true,
    })
  })

  it('forward_messages 不带 remove_caption(那是 copyMessages 独有的)', async () => {
    const mock = mockTelegram([{ message_id: 1 }])
    await call('forward_messages', { chatId: 1, fromChatId: 2, messageIds: [1] })
    await expect(sentBody(mock)).resolves.toEqual({ chat_id: 1, from_chat_id: 2, message_ids: [1] })
  })

  it('send_poll 的两条互斥约束在本地就拦下', async () => {
    const both = mockTelegram({})
    const period = await call('send_poll', {
      chatId: 1,
      question: 'q',
      options: ['a', 'b'],
      openPeriod: 60,
      closeDate: 1700000000,
    })
    expect(period.status).toBe(400)
    expect(both).not.toHaveBeenCalled()

    vi.unstubAllGlobals()
    const quiz = mockTelegram({})
    const res = await call('send_poll', { chatId: 1, question: 'q', options: ['a', 'b'], type: 'quiz' })
    expect(res.status).toBe(400)
    await expect(res.json()).resolves.toMatchObject({ message: 'send_poll quiz polls require correctOptionId' })
    expect(quiz).not.toHaveBeenCalled()
  })

  it('edit_message_text:目标二选一,两个都给或都不给都拒', async () => {
    const mock = mockTelegram({})
    const both = await call('edit_message_text', { chatId: 1, messageId: 2, inlineMessageId: 'inline', text: 't' })
    expect(both.status).toBe(400)

    const neither = await call('edit_message_text', { chatId: 1, text: 't' })
    expect(neither.status).toBe(400)
    expect(mock).not.toHaveBeenCalled()
  })

  it('edit_message_text:编辑 inline message 时上游只回 true,出参走 message:null 那条分支', async () => {
    mockTelegram(true)
    const res = await call('edit_message_text', { inlineMessageId: 'inline-1', text: 't' })
    await expect(res.json()).resolves.toEqual({
      content: { edited: true, message: null, inlineMessageId: 'inline-1' },
    })

    vi.unstubAllGlobals()
    mockTelegram({ message_id: 5, date: 1, chat: { id: 1, type: 'private' }, text: 't' })
    await expect((await call('edit_message_text', { chatId: 1, messageId: 5, text: 't' })).json())
      .resolves.toMatchObject({ content: { edited: true, inlineMessageId: null, message: { messageId: 5 } } })
  })

  it('create_chat_invite_link:memberLimit 与 createsJoinRequest 不能同时给', async () => {
    const mock = mockTelegram({})
    const res = await call('create_chat_invite_link', { chatId: 1, memberLimit: 10, createsJoinRequest: true })
    expect(res.status).toBe(400)
    await expect(res.json()).resolves.toMatchObject({
      message: 'memberLimit cannot be combined with createsJoinRequest',
    })
    expect(mock).not.toHaveBeenCalled()
  })

  it('畸形 bot token 在本地就拒 —— 它会成为 URL 的路径段,带 / 就能改写请求目标', async () => {
    const mock = mockTelegram({})
    const res = await call('get_me', {}, { auth: '123:AA/../../evil' })
    expect(res.status).toBe(400)
    await expect(res.json()).resolves.toMatchObject({
      code: 'invalid_argument',
      message: 'telegram bot token is malformed',
    })
    expect(mock).not.toHaveBeenCalled()
  })

  it('没配 authRef → unavailable 且不打上游', async () => {
    const mock = mockTelegram({})
    const res = await call('get_me', {}, { auth: null })
    expect(res.status).toBe(503)
    expect(((await res.json()) as { message: string }).message).toContain('authRef')
    expect(mock).not.toHaveBeenCalled()
  })
})

describe('响应整形', () => {
  it('get_updates:逐条 update 按声明裁剪,未声明的字段丢掉', async () => {
    mockTelegram([
      {
        update_id: 100,
        message: { message_id: 1, date: 2, chat: { id: 3, type: 'private' }, text: 'hi', unknown: 'drop' },
        unknown_family: true,
      },
    ])
    const res = await call('get_updates', { limit: 1 })
    await expect(res.json()).resolves.toEqual({
      content: {
        updates: [{
          updateId: 100,
          message: {
            messageId: 1,
            date: 2,
            chat: { id: 3, type: 'private' },
            text: 'hi',
          },
        }],
      },
    })
  })

  it('get_chat_administrators:成员列表逐条按 chat member 形状裁剪', async () => {
    mockTelegram([
      { status: 'creator', user: { id: 1, is_bot: false, first_name: 'A', username: 'a' }, is_anonymous: false },
    ])
    const res = await call('get_chat_administrators', { chatId: -100 })
    await expect(res.json()).resolves.toEqual({
      content: {
        administrators: [{
          status: 'creator',
          user: { id: 1, isBot: false, firstName: 'A', username: 'a' },
          isAnonymous: false,
        }],
      },
    })
  })

  it('只关心成败的 action 统一回 {success:true}', async () => {
    mockTelegram(true)
    await expect((await call('delete_message', { chatId: 1, messageId: 2 })).json())
      .resolves.toEqual({ content: { success: true } })
  })
})
