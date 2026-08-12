/**
 * 飞书自定义机器人(群 webhook)的业务逻辑。
 *
 * 迁移自 open-connector `src/providers/feishu_custom_bot/executors.ts`,语义等价、写法本地化:
 * 凭证从 `ctx.upstreamAuth` 取,出站走 `guardedFetch`,错误抛 `TBError` 七码。
 *
 * 与其他迁移产物不同的三处:
 * - **凭证既可以是完整 webhook URL,也可以只是 token**。上游两种都收,这里保留 —— 用户从
 *   飞书后台复制到的就是整条 URL,强迫他们剪出 token 是没必要的摩擦。
 * - **可选的加签**(飞书群机器人的一种安全设置):开了就要在 body 里带 timestamp + sign。
 *   上游用 `node:crypto` 的 createHmac,插件面不得含 Node 内建,故改用 Web Crypto ——
 *   算法与产物完全一致(HMAC-SHA256,key 是 `timestamp\n<secret>`,消息为空,取 base64)。
 *
 *   加签密钥走 **`credentialFields`**(与 webhook 同一个 secret 里的两个字段),不走
 *   `providerConfig` —— 后者会明文进节点记录,任何对该节点有 read 的 SK 都能从
 *   `system/registry get` 读走。密钥必须留在 SecretStore 那条只写不读的通路上。
 * - **20 KB 请求体上限**:飞书的硬限制,本地先挡住,免得白跑一趟出站。
 */

import type { z } from 'zod/v4'
import { TBError } from '@tool-bridge/plugin-sdk'
import type {
  sendImageMessageInput,
  sendInteractiveMessageInput,
  sendShareChatMessageInput,
  sendTextMessageInput,
} from './schema'
import type { sendPostMessageInput } from './schema.handwritten'
import { type ProviderContext, requireCredential } from '../_runtime/plugin'
import { upstreamError } from '../_runtime/upstreamError'
import { guardedFetch } from '../_runtime/guardedFetch'

const SERVICE = 'feishu_custom_bot'
const API_BASE = 'https://open.feishu.cn'
const WEBHOOK_PREFIX = '/open-apis/bot/v2/hook/'
const MAX_PAYLOAD_BYTES = 20 * 1024

/** 飞书对"发送过频"用的业务码;它不走 HTTP 429。 */
const RATE_LIMITED_CODE = 11232

type Json = Record<string, unknown>

/** 凭证:整条 webhook URL 或裸 token 都收。 */
function webhookUrl(ctx: ProviderContext): URL {
  const raw = requireCredential(ctx, SERVICE, 'webhook').trim()
  const url = raw.includes('://') ? new URL(raw) : new URL(`${WEBHOOK_PREFIX}${raw}`, API_BASE)
  if (url.origin !== API_BASE || !url.pathname.startsWith(WEBHOOK_PREFIX)) {
    // 凭证决定出站目标,这里不放行任意 URL —— guardedFetch 只拦私网,拦不住"公网上的
    // 别人家接口",而 webhook token 会被原样发过去。
    throw new TBError(
      'invalid_argument',
      `${SERVICE} 的凭证必须是 ${API_BASE}${WEBHOOK_PREFIX}<token> 形式的 webhook 地址或其 token`,
    )
  }
  return url
}

/** 加签:HMAC-SHA256,key = `<timestamp>\n<secret>`,消息为空,base64。 */
async function sign(timestamp: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(`${timestamp}\n${secret}`),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const mac = await crypto.subtle.sign('HMAC', key, new Uint8Array(0))
  return btoa(String.fromCharCode(...new Uint8Array(mac)))
}

/** 飞书回的是 `{code,msg,data}` 信封;HTTP 200 也可能 code!=0。 */
interface Envelope {
  code: number | null
  data: Json
  msg: string | null
}

function envelopeOf(payload: unknown): Envelope | null {
  if (payload === null || typeof payload !== 'object' || Array.isArray(payload)) return null
  const record = payload as Json
  const code = typeof record.code === 'number' ? record.code : null
  const status = typeof record.StatusCode === 'number' ? record.StatusCode : null
  const msg = typeof record.msg === 'string' ? record.msg : null
  const statusMsg = typeof record.StatusMessage === 'string' ? record.StatusMessage : null
  return {
    code: code ?? status,
    msg: msg ?? statusMsg,
    data: typeof record.data === 'object' && record.data !== null && !Array.isArray(record.data)
      ? (record.data as Json)
      : {},
  }
}

async function send(payload: Json, ctx: ProviderContext): Promise<Json> {
  const target = webhookUrl(ctx)

  // 加签是可选的群机器人安全设置(secret 里的可选字段;没配就不带这两个键 ——
  // 未开加签的群会拒收带 sign 的请求)。
  const secret = ctx.credentials?.signingSecret
  const signed = typeof secret === 'string' && secret !== ''
  const body: Json = signed
    ? { timestamp: Math.floor(Date.now() / 1000).toString(), sign: '', ...payload }
    : { ...payload }
  if (signed) {
    body.sign = await sign(body.timestamp as string, secret)
  }

  const text = JSON.stringify(body)
  if (new TextEncoder().encode(text).byteLength > MAX_PAYLOAD_BYTES) {
    throw new TBError('invalid_argument', `${SERVICE} 的请求体不得超过 20 KB(飞书硬限制)`)
  }

  const response = await guardedFetch(target.toString(), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: text,
  })

  const raw = await response.text()
  let parsed: unknown = null
  try {
    parsed = raw.trim() === '' ? null : JSON.parse(raw)
  } catch {
    parsed = raw.trim()
  }
  const envelope = envelopeOf(parsed)
  const message = envelope?.msg ?? (typeof parsed === 'string' ? parsed : '') ?? ''

  if (!response.ok) {
    throw upstreamError(response.status, message || `飞书返回 HTTP ${response.status}`)
  }
  // HTTP 200 但业务码非 0:飞书用信封表达失败,不看这里会把错误当成功返回。
  if (envelope?.code !== null && envelope?.code !== undefined && envelope.code !== 0) {
    if (envelope.code === RATE_LIMITED_CODE) {
      throw new TBError('rate_limited', message || '飞书自定义机器人发送过频', { retryable: true })
    }
    throw new TBError('invalid_argument', message || `飞书返回业务码 ${envelope.code}`)
  }

  return { code: envelope?.code ?? 0, msg: envelope?.msg ?? 'success', data: envelope?.data ?? {} }
}

export function sendTextMessage(
  input: z.infer<typeof sendTextMessageInput>,
  ctx: ProviderContext,
): Promise<Json> {
  return send({ msg_type: 'text', content: { text: input.text } }, ctx)
}

export function sendPostMessage(
  input: z.infer<typeof sendPostMessageInput>,
  ctx: ProviderContext,
): Promise<Json> {
  return send({ msg_type: 'post', content: { post: input.post } }, ctx)
}

export function sendImageMessage(
  input: z.infer<typeof sendImageMessageInput>,
  ctx: ProviderContext,
): Promise<Json> {
  return send({ msg_type: 'image', content: { image_key: input.imageKey } }, ctx)
}

export function sendShareChatMessage(
  input: z.infer<typeof sendShareChatMessageInput>,
  ctx: ProviderContext,
): Promise<Json> {
  return send({ msg_type: 'share_chat', content: { share_chat_id: input.shareChatId } }, ctx)
}

export function sendInteractiveMessage(
  input: z.infer<typeof sendInteractiveMessageInput>,
  ctx: ProviderContext,
): Promise<Json> {
  return send({ msg_type: 'interactive', card: input.card }, ctx)
}
