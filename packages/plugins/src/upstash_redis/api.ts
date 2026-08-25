/**
 * Upstash Redis 的业务逻辑(REST API 上的七个字符串键命令)。
 *
 * 迁移自 open-connector `src/providers/upstash_redis/runtime.ts`,语义等价、写法本地化:
 * 凭证从 `ctx.credentials` 取(**两个字段**:restUrl + restToken),出站走 `guardedFetch`,
 * 错误抛 `TBError` 七码。
 *
 * 四处上游细节决定了这里的形状:
 * - **凭证里带出站目标**(restUrl)。guardedFetch 只拦私网,拦不住"公网上的别人家接口",
 *   而 restToken 会以 Bearer 头原样发过去 —— 故这里保留上游对 restUrl 的全套收紧
 *   (https、无凭证、无端口、无路径/查询/片段、主机名必须以 `.upstash.io` 结尾)。
 * - **信封式错误**:Upstash 用 HTTP 200 + `{"error": "..."}` 表达 Redis 命令级失败
 *   (`ERR wrong number of arguments` 之类),必须识别,不能当成功返回。
 * - **配额与限流藏在错误消息里**,不走 HTTP 429:上游注释明说"quota 与 throttling 报成
 *   400 里的 Redis 错误,消息是唯一信号"。故按消息文本判定后归 429(可重试)。
 * - **key 去空白、value 原样**。上游对 key 用 `requiredString`(trim),对 value 用
 *   `optionalRawString`(逐字节保留)并写了理由:Redis 字符串是不透明的,SET 写进去什么
 *   GET 就得读回什么。这处不对称是有意的,保留。
 *
 * 没有 credentialProbe:七个 action 的 effect 都被播种成 write(探针必须是 read),
 * 选不出合规的探针。上游的 credentialValidator 打的是 `PING`,而 PING 不是一个 action。
 */

import type { z } from 'zod/v4'
import { TBError } from '@tool-bridge/plugin-sdk'
import type {
  deleteInput,
  existsInput,
  expireInput,
  getInput,
  scanInput,
  setInput,
  ttlInput,
} from './schema'
import { asJsonObject as record, trimmedText as text } from '../_runtime/jsonValue'
import { type ProviderContext, requireCredential } from '../_runtime/plugin'
import { createProviderHttpClient } from '../_runtime/providerHttp'
import { upstreamError } from '../_runtime/upstreamError'

const SERVICE = 'upstash_redis'
/** 只认官方端点:凭证决定出站目标,不能放行任意主机。 */
const HOSTNAME_SUFFIX = '.upstash.io'
const http = createProviderHttpClient({ service: SERVICE })

type Json = Record<string, unknown>
type CommandArgument = number | string

/** 上游回的形状不符合契约 —— 是上游的问题,不是调用方的错。 */
function responseError(message: string): TBError {
  return new TBError('unavailable', message, { retryable: true })
}

/** 配置错误(凭证里的 restUrl 不合规):调用方要改配置,重试没有意义。 */
function configError(message: string): TBError {
  return new TBError('invalid_argument', `${SERVICE} 的 restUrl ${message}`)
}

/**
 * Upstash 把配额耗尽与连接数超限报成普通 Redis 错误(HTTP 400 + 错误消息),
 * 消息文本是唯一的信号。判中就归 429 让调用方稍后重试。
 */
function isQuotaMessage(message: string): boolean {
  const normalized = message.toLowerCase()
  return normalized.includes('limit exceeded') || normalized.includes('connections exceeded')
}

/**
 * 校验并归一凭证里的 REST URL。上游这一串检查看着啰嗦,但每一条都在堵一个真实的洞:
 * 带 path/query 会让命令打到别的端点,带端口或非 upstash.io 主机则是把 restToken
 * 送给任意一台公网主机。
 */
function restUrl(ctx: ProviderContext): URL {
  const raw = requireCredential(ctx, SERVICE, 'restUrl')
  let url: URL
  try {
    url = new URL(raw.trim())
  } catch {
    throw configError('不是合法 URL')
  }
  if (url.protocol !== 'https:') throw configError('必须用 https')
  if (url.username !== '' || url.password !== '') throw configError('不能带用户名或密码')
  if (url.port !== '') throw configError('不能带端口')
  if (url.pathname !== '/' || url.search !== '' || url.hash !== '') {
    throw configError('不能带路径、查询串或片段')
  }
  if (!url.hostname.endsWith(HOSTNAME_SUFFIX)) {
    throw configError(`必须是官方 ${HOSTNAME_SUFFIX} 端点`)
  }
  return url
}

/** 非 2xx 的归一。消息取自 `error` / `message`,配额消息优先于 HTTP 状态。 */
function commandError(status: number, payload: unknown, fallbackBody: string): TBError {
  const body = record(payload)
  const message = text(body?.error)
    ?? text(body?.message)
    ?? text(fallbackBody)
    ?? `Upstash Redis 返回 HTTP ${status}`
  if (isQuotaMessage(message)) return upstreamError(429, message)
  return upstreamError(status, message)
}

/**
 * 拆信封。Upstash 的成功响应是 `{"result": ...}`;命令级失败是 **HTTP 200 +
 * `{"error": "..."}`**,当成功返回就把一次失败悄悄变成了 null 结果。
 */
function unwrap(payload: unknown): unknown {
  const body = record(payload)
  if (body === undefined) throw responseError('Upstash Redis 响应不是对象')
  const error = text(body.error)
  if (error !== undefined) {
    // 命令级错误基本都是"参数不对"这类不会自愈的问题,归 invalid_argument;
    // 但配额消息也可能从这条路上来,那是可重试的。
    if (isQuotaMessage(error)) throw upstreamError(429, error)
    throw new TBError('invalid_argument', error)
  }
  if (!Object.hasOwn(body, 'result')) throw responseError('Upstash Redis 响应缺 result')
  return body.result
}

async function command(ctx: ProviderContext, args: readonly CommandArgument[]): Promise<unknown> {
  const result = await http.request({
    baseUrl: restUrl(ctx),
    path: '/',
    method: 'POST',
    headers: {
      accept: 'application/json',
      authorization: `Bearer ${requireCredential(ctx, SERVICE, 'restToken')}`,
    },
    json: args,
    invalidJsonMessage: 'Upstash Redis 返回了非 JSON 响应',
    mapError: ({ data, rawText, status }) => commandError(status, data, rawText ?? ''),
  })
  return unwrap(result.data)
}

/** key 按上游语义去空白;Zod 的 `min(1)` 拦不住纯空白串,故这层必须保留。 */
function redisKey(value: string): string {
  const key = text(value)
  if (key === undefined) throw new TBError('invalid_argument', 'key 不能是空白')
  return key
}

function stringOrNull(result: unknown, name: string): string | null {
  if (result === null || typeof result === 'string') return result
  throw responseError(`Upstash Redis 的 ${name} 返回值不合契约`)
}

function integer(result: unknown, name: string): number {
  if (typeof result !== 'number' || !Number.isInteger(result)) {
    throw responseError(`Upstash Redis 的 ${name} 返回值不合契约`)
  }
  return result
}

/** Redis 的 0/1 计数结果;别的数字说明命令或响应对不上。 */
function flag(result: unknown, name: string): boolean {
  const value = integer(result, name)
  if (value !== 0 && value !== 1) throw responseError(`Upstash Redis 的 ${name} 返回值不合契约`)
  return value === 1
}

/** SCAN 回的是 `[cursor, keys]`;cursor 可能是字符串也可能是数字,统一成字符串。 */
function scanPage(result: unknown): { keys: string[], nextCursor: string } {
  if (!Array.isArray(result) || result.length !== 2) {
    throw responseError('Upstash Redis 的 SCAN 返回值不合契约')
  }
  const [cursor, keys] = result as [unknown, unknown]
  if ((typeof cursor !== 'string' && typeof cursor !== 'number') || !Array.isArray(keys)) {
    throw responseError('Upstash Redis 的 SCAN 返回值不合契约')
  }
  if (keys.some(key => typeof key !== 'string')) {
    throw responseError('Upstash Redis 的 SCAN 返回了非字符串键')
  }
  return { nextCursor: String(cursor), keys: keys as string[] }
}

export async function get(input: z.infer<typeof getInput>, ctx: ProviderContext): Promise<Json> {
  const result = await command(ctx, ['GET', redisKey(input.key)])
  return { value: stringOrNull(result, 'GET') }
}

export async function set(input: z.infer<typeof setInput>, ctx: ProviderContext): Promise<Json> {
  const args: CommandArgument[] = ['SET', redisKey(input.key), input.value]
  if (input.expirationSeconds !== undefined) args.push('EX', input.expirationSeconds)
  if (input.condition !== undefined) args.push(input.condition)

  const result = await command(ctx, args)
  // 条件写(NX/XX)不满足时 Redis 回 null,那是**业务结果**不是错误;其余取值说明响应对不上。
  if (result !== 'OK' && result !== null) {
    throw responseError('Upstash Redis 的 SET 返回值不合契约')
  }
  return { stored: result === 'OK' }
}

// 名字与 Redis 命令一致;`delete` 是保留字,不能直接当函数名,故导出名加后缀。
export async function deleteKey(input: z.infer<typeof deleteInput>, ctx: ProviderContext): Promise<Json> {
  const result = await command(ctx, ['DEL', redisKey(input.key)])
  return { deleted: flag(result, 'DEL') }
}

export async function exists(input: z.infer<typeof existsInput>, ctx: ProviderContext): Promise<Json> {
  const result = await command(ctx, ['EXISTS', redisKey(input.key)])
  return { exists: flag(result, 'EXISTS') }
}

export async function expire(input: z.infer<typeof expireInput>, ctx: ProviderContext): Promise<Json> {
  const result = await command(ctx, ['EXPIRE', redisKey(input.key), input.expirationSeconds])
  return { updated: flag(result, 'EXPIRE') }
}

export async function ttl(input: z.infer<typeof ttlInput>, ctx: ProviderContext): Promise<Json> {
  const result = await command(ctx, ['TTL', redisKey(input.key)])
  return { ttlSeconds: integer(result, 'TTL') }
}

export async function scan(input: z.infer<typeof scanInput>, ctx: ProviderContext): Promise<Json> {
  // 缺省从 0 开始:上游用 `optionalString(cursor) ?? '0'`,纯空白的 cursor 也回到 0。
  const args: CommandArgument[] = ['SCAN', text(input.cursor) ?? '0']
  const match = text(input.match)
  if (match !== undefined) args.push('MATCH', match)
  if (input.count !== undefined) args.push('COUNT', input.count)

  const page = scanPage(await command(ctx, args))
  return { ...page, complete: page.nextCursor === '0' }
}
