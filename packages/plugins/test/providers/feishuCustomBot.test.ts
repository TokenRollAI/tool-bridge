import {
  base64urlEncode,
  type CallContext,
  encodeCallContext,
  encodeCredentialValues,
  HEADER_TB_CONTEXT,
  HEADER_TB_UPSTREAM_AUTH,
} from '@tool-bridge/core'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createFeishuCustomBotPlugin } from '../../src/feishu_custom_bot/index'

/**
 * 飞书自定义机器人的 wire 级验收。重点在三处迁移最容易迁丢的地方:
 * 凭证的两种形态(整条 URL / 裸 token)、可选加签的算法、以及"HTTP 200 但业务码非 0"。
 *
 * 凭证是**两字段**(webhook + 可选 signingSecret),都在 secret 里 —— 加签密钥曾走
 * `providerConfig`,那会明文进节点记录被任何有 read 的 SK 读走。
 */

const PLUGIN_TOKEN = 'tbp_test'
const ENV = { PLUGIN_TOKEN }
const TOKEN = 'abc-123-def'
const WEBHOOK = `https://open.feishu.cn/open-apis/bot/v2/hook/${TOKEN}`
const plugin = createFeishuCustomBotPlugin()

function caller(): CallContext {
  return {
    keyId: 'k1',
    owner: 'agent:tester',
    scopes: [],
    traceId: 't1',
    mountPath: 'chat/feishu-bot',
    exportId: 'actions',
  }
}

function call(
  name: string,
  args: unknown,
  opts: { raw?: string | null, signingSecret?: string, webhook?: string } = {},
): Promise<Response> {
  const headers: Record<string, string> = {
    'authorization': `Bearer ${PLUGIN_TOKEN}`,
    'content-type': 'application/json',
    [HEADER_TB_CONTEXT]: encodeCallContext(caller()),
  }
  // opts.raw 给出时原样注入(测"凭证不是 JSON"这类负例);否则按字段表编码。
  const auth = opts.raw !== undefined
    ? opts.raw
    : encodeCredentialValues({
        webhook: opts.webhook ?? WEBHOOK,
        ...(opts.signingSecret === undefined ? {} : { signingSecret: opts.signingSecret }),
      })
  if (auth !== null) {
    headers[HEADER_TB_UPSTREAM_AUTH] = base64urlEncode(new TextEncoder().encode(auth))
  }
  return Promise.resolve(plugin.fetch(
    new Request('https://plugin.test/', {
      method: 'POST',
      headers,
      body: JSON.stringify({ tool: 'Call', arguments: { name, args } }),
    }),
    ENV as never,
  ))
}

function mockFeishu(status: number, payload: unknown): ReturnType<typeof vi.fn> {
  const fn = vi.fn(() => Promise.resolve(new Response(JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json' },
  })))
  vi.stubGlobal('fetch', fn)
  return fn
}

const OK = { code: 0, msg: 'success', data: {} }

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('契约面', () => {
  it('List 出五个 action,都带 schema', async () => {
    const res = await plugin.fetch(
      new Request('https://plugin.test/', {
        method: 'POST',
        headers: {
          authorization: `Bearer ${PLUGIN_TOKEN}`,
          [HEADER_TB_CONTEXT]: encodeCallContext(caller()),
        },
        body: JSON.stringify({ tool: 'List', arguments: {} }),
      }),
      ENV as never,
    )
    const tools = (await res.json()) as Array<{ inputSchema?: unknown, name: string, outputSchema?: unknown }>
    expect(tools.map(t => t.name).sort()).toEqual([
      'send_image_message',
      'send_interactive_message',
      'send_post_message',
      'send_share_chat_message',
      'send_text_message',
    ])
    for (const tool of tools) {
      expect(tool.inputSchema, `${tool.name} 缺 inputSchema`).toBeDefined()
      expect(tool.outputSchema, `${tool.name} 缺 outputSchema`).toBeDefined()
    }
  })
})

describe('凭证的两种形态', () => {
  it('整条 webhook URL', async () => {
    const mock = mockFeishu(200, OK)
    await call('send_text_message', { text: 'hi' })
    expect((mock.mock.calls[0] as [Request])[0].url).toBe(WEBHOOK)
  })

  it('裸 token 也收(用户从飞书后台复制到的常是整条 URL,两种都该能用)', async () => {
    const mock = mockFeishu(200, OK)
    await call('send_text_message', { text: 'hi' }, { webhook: TOKEN })
    expect((mock.mock.calls[0] as [Request])[0].url).toBe(WEBHOOK)
  })

  it('**指向别处的 URL 被拒**,且不出站(否则 webhook token 会被发给第三方)', async () => {
    const mock = mockFeishu(200, OK)
    const res = await call('send_text_message', { text: 'hi' }, {
      webhook: 'https://evil.example.com/open-apis/bot/v2/hook/x',
    })
    expect(res.status).toBe(400)
    expect(mock).not.toHaveBeenCalled()
  })

  it('没配 authRef → unavailable 且不出站', async () => {
    const mock = mockFeishu(200, OK)
    expect((await call('send_text_message', { text: 'hi' }, { raw: null })).status).toBe(503)
    expect(mock).not.toHaveBeenCalled()
  })
})

describe('消息类型', () => {
  it('text 进 content.text', async () => {
    const mock = mockFeishu(200, OK)
    await call('send_text_message', { text: 'hello' })
    await expect((mock.mock.calls[0] as [Request])[0].json()).resolves.toEqual({
      msg_type: 'text',
      content: { text: 'hello' },
    })
  })

  it('post 进 content.post(手写 schema 的路径)', async () => {
    const mock = mockFeishu(200, OK)
    const post = { zh_cn: { title: '标题', content: [[{ tag: 'text', text: '正文' }]] } }
    await call('send_post_message', { post })
    await expect((mock.mock.calls[0] as [Request])[0].json()).resolves.toEqual({
      msg_type: 'post',
      content: { post },
    })
  })

  it('post 两个语言块都不给 → 400 且不出站(手写 refine 真的生效)', async () => {
    const mock = mockFeishu(200, OK)
    const res = await call('send_post_message', { post: {} })
    expect(res.status).toBe(400)
    expect(((await res.json()) as { code: string }).code).toBe('invalid_argument')
    expect(mock).not.toHaveBeenCalled()
  })

  it('interactive 用 card 而不是 content(飞书这里的字段名不同)', async () => {
    const mock = mockFeishu(200, OK)
    const card = { config: { wide_screen_mode: true }, elements: [] }
    await call('send_interactive_message', { card })
    await expect((mock.mock.calls[0] as [Request])[0].json()).resolves.toEqual({
      msg_type: 'interactive',
      card,
    })
  })
})

describe('加签(可选的群机器人安全设置)', () => {
  it('配了 signingSecret 就带 timestamp + sign,算法与飞书一致', async () => {
    const mock = mockFeishu(200, OK)
    await call('send_text_message', { text: 'hi' }, { signingSecret: 's3cret' })

    const body = (await (mock.mock.calls[0] as [Request])[0].json()) as {
      sign: string
      timestamp: string
    }
    expect(body.timestamp).toMatch(/^\d+$/)

    // 独立复算一遍:HMAC-SHA256,key=`<timestamp>\n<secret>`,消息为空,base64。
    const key = await crypto.subtle.importKey(
      'raw',
      new TextEncoder().encode(`${body.timestamp}\ns3cret`),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign'],
    )
    const mac = await crypto.subtle.sign('HMAC', key, new Uint8Array(0))
    expect(body.sign).toBe(btoa(String.fromCharCode(...new Uint8Array(mac))))
  })

  it('没配 signingSecret 就不带这两个字段(未开加签的群会拒收带 sign 的请求)', async () => {
    const mock = mockFeishu(200, OK)
    await call('send_text_message', { text: 'hi' })
    const body = (await (mock.mock.calls[0] as [Request])[0].json()) as Record<string, unknown>
    expect(body).not.toHaveProperty('sign')
    expect(body).not.toHaveProperty('timestamp')
  })
})

describe('错误归一', () => {
  it('**HTTP 200 但业务码非 0 也是失败**(飞书用信封表达错误)', async () => {
    mockFeishu(200, { code: 19024, msg: 'key words not found' })
    const res = await call('send_text_message', { text: 'hi' })
    expect(res.status).toBe(400)
    await expect(res.json()).resolves.toMatchObject({
      code: 'invalid_argument',
      message: 'key words not found',
    })
  })

  it('业务码 11232(发送过频)→ rate_limited 且 retryable', async () => {
    mockFeishu(200, { code: 11232, msg: 'too frequent' })
    const res = await call('send_text_message', { text: 'hi' })
    expect(res.status).toBe(429)
    await expect(res.json()).resolves.toMatchObject({ code: 'rate_limited', retryable: true })
  })

  it('HTTP 5xx → unavailable 且 retryable', async () => {
    mockFeishu(503, { msg: 'upstream down' })
    await expect((await call('send_text_message', { text: 'hi' })).json())
      .resolves.toMatchObject({ code: 'unavailable', retryable: true })
  })

  it('body 超 20 KB → 400 且不出站(飞书硬限制,白跑一趟没意义)', async () => {
    const mock = mockFeishu(200, OK)
    const res = await call('send_text_message', { text: 'x'.repeat(21_000) })
    expect(res.status).toBe(400)
    expect(((await res.json()) as { message: string }).message).toContain('20 KB')
    expect(mock).not.toHaveBeenCalled()
  })

  it('成功时返回归一的信封', async () => {
    mockFeishu(200, { code: 0, msg: 'success', data: { message_id: 'om_x' } })
    await expect((await call('send_text_message', { text: 'hi' })).json()).resolves.toEqual({
      content: { code: 0, msg: 'success', data: { message_id: 'om_x' } },
    })
  })
})

describe('加签密钥的存放位置', () => {
  it('**密钥来自 secret 而不是 providerConfig**(后者会明文进节点记录)', async () => {
    const mock = mockFeishu(200, OK)
    // 只在 mountConfig 里给 signingSecret,secret 里不给 —— 不该被当成加签密钥用。
    const headers: Record<string, string> = {
      'authorization': `Bearer ${PLUGIN_TOKEN}`,
      'content-type': 'application/json',
      [HEADER_TB_CONTEXT]: encodeCallContext({
        keyId: 'k1',
        owner: 'agent:tester',
        scopes: [],
        traceId: 't1',
        mountPath: 'chat/feishu-bot',
        exportId: 'actions',
        mountConfig: { signingSecret: 'FROM_PROVIDER_CONFIG' },
      }),
      [HEADER_TB_UPSTREAM_AUTH]: base64urlEncode(
        new TextEncoder().encode(encodeCredentialValues({ webhook: WEBHOOK })),
      ),
    }
    await plugin.fetch(
      new Request('https://plugin.test/', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          tool: 'Call',
          arguments: { name: 'send_text_message', args: { text: 'hi' } },
        }),
      }),
      ENV as never,
    )

    const body = (await (mock.mock.calls[0] as [Request])[0].json()) as Record<string, unknown>
    // 没有从 providerConfig 取密钥 → 不带加签字段。
    expect(body, 'providerConfig 里的 signingSecret 仍被当成密钥使用').not.toHaveProperty('sign')
    expect(JSON.stringify(body)).not.toContain('FROM_PROVIDER_CONFIG')
  })
})
