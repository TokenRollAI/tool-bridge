/**
 * Plugin 传输契约编解码(Proto §8.3;纯逻辑)。
 *
 * 与 §1.4 节点调用同形:POST {endpoint},body `{"tool":"<Method>","arguments":{...}}`
 * (arguments 按名传递,opts 整体传不平铺);调用上下文经 `X-TB-Context` header
 * 以 CallContext JSON 的 base64url 承载(唯一载体,body 不重复);`X-TB-Request-Id`
 * 每次逻辑调用唯一、重试不变(去重表见 dedupe.ts)。
 * 单次请求/响应 ≤ 1 MiB,超限 → invalid_argument;更大内容经 `{ "$ref": <URL> }`。
 */

import { z } from 'zod'
import { TBError } from '../errors'
import { base64urlDecode, base64urlEncode } from '../secret/secretStore'
import { ACTIONS, type Action, type CallContext } from '../types'

declare const TextEncoder: { new (): { encode(input: string): Uint8Array } }
declare const TextDecoder: { new (): { decode(input: Uint8Array): string } }

/** 平台 → Plugin 的调用上下文 header(Proto §8.3)。 */
export const HEADER_TB_CONTEXT = 'X-TB-Context'
/** 逻辑调用唯一 id 的 header;重试时不变,Plugin 以此去重实现幂等(Proto §8.3)。 */
export const HEADER_TB_REQUEST_ID = 'X-TB-Request-Id'

/** 单次请求/响应体上限:1 MiB(Proto §8.3)。 */
export const PLUGIN_PAYLOAD_MAX_BYTES = 1024 * 1024

const callContextSchema = z.object({
  keyId: z.string().min(1),
  owner: z.string().min(1),
  scopes: z.array(
    z.object({
      pattern: z.string().min(1),
      actions: z.array(z.enum(ACTIONS as [Action, ...Action[]])),
      effect: z.enum(['allow', 'deny']).optional(),
    }),
  ),
  registerPaths: z.array(z.string()).optional(),
  traceId: z.string().min(1),
})

/** CallContext → base64url(`X-TB-Context` header 值)。 */
export function encodeCallContext(ctx: CallContext): string {
  return base64urlEncode(new TextEncoder().encode(JSON.stringify(ctx)))
}

/**
 * `X-TB-Context` header 值 → CallContext。
 * 坏 base64url / 非 JSON / 形状不符 → invalid_argument;未知字段剥离(消费方忽略未知字段)。
 */
export function decodeCallContext(header: string): CallContext {
  let text: string
  try {
    text = new TextDecoder().decode(base64urlDecode(header))
  } catch {
    throw new TBError('invalid_argument', `${HEADER_TB_CONTEXT} 非法 base64url`)
  }
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    throw new TBError('invalid_argument', `${HEADER_TB_CONTEXT} 内容非 JSON`)
  }
  const parsed = callContextSchema.safeParse(raw)
  if (!parsed.success) {
    const issue = parsed.error.issues[0]
    throw new TBError(
      'invalid_argument',
      `${HEADER_TB_CONTEXT} 形状非法:${issue?.path.join('.') ?? ''} ${issue?.message ?? ''}`,
    )
  }
  return parsed.data as CallContext
}

/** 请求体形状(Proto §8.3):tool 是**方法名**(如 "List"),arguments 按名传递。 */
export interface PluginCall {
  tool: string
  arguments: Record<string, unknown>
}

const pluginCallSchema = z.object({
  tool: z.string().min(1),
  arguments: z.record(z.unknown()),
})

/** payload(UTF-8 字节数)超 1 MiB → invalid_argument(Proto §8.3)。 */
export function assertPluginPayloadSize(payload: string): void {
  const bytes = new TextEncoder().encode(payload).length
  if (bytes > PLUGIN_PAYLOAD_MAX_BYTES) {
    throw new TBError(
      'invalid_argument',
      `payload ${bytes} 字节超过上限 ${PLUGIN_PAYLOAD_MAX_BYTES}(Proto §8.3 ≤ 1 MiB;更大内容经 $ref)`,
    )
  }
}

/** 构造请求体 JSON;超 1 MiB → invalid_argument。 */
export function encodePluginCall(call: PluginCall): string {
  const body = JSON.stringify({ tool: call.tool, arguments: call.arguments })
  assertPluginPayloadSize(body)
  return body
}

/** 解析请求体(Plugin 侧/平台 stub 侧);先过体积守卫再 parse,坏形状 → invalid_argument。 */
export function decodePluginCall(body: string): PluginCall {
  assertPluginPayloadSize(body)
  let raw: unknown
  try {
    raw = JSON.parse(body)
  } catch {
    throw new TBError('invalid_argument', '请求体非 JSON(Proto §8.3)')
  }
  const parsed = pluginCallSchema.safeParse(raw)
  if (!parsed.success) {
    const issue = parsed.error.issues[0]
    throw new TBError(
      'invalid_argument',
      `请求体形状非法:${issue?.path.join('.') ?? ''} ${issue?.message ?? ''}(需 {"tool","arguments"})`,
    )
  }
  return parsed.data
}
