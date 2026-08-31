/**
 * `createProviderHttpClient` 之上的第二层收敛:把各 provider 手写的「注入认证头 +
 * 从错误体捞消息」样板参数化成声明。
 *
 * 与 providerHttp 的分工:那一层负责传输(guardedFetch、超时、重定向、脱敏)与响应
 * 解码;这里只收两件每个 provider 都在重复写的事 —— 按声明的头型注入单值凭证,以及
 * 按声明的键序提取错误消息。响应后处理(空体当 `{}`、信封里的业务码……)仍留在各
 * provider 的薄 wrapper 里,那些是它们真正的差异。
 *
 * 错误措辞是 provider 对外行为的一部分,故**这里不带任何默认文案**:标准提取必须把
 * 键序与兜底成对声明(`errorMessage`),怪异上游(错误码码表、DRF 字段级错误、GraphQL
 * errors 数组……)整段覆写 `mapError`,helper 仍承载认证与传输。两者互斥,声明冲突
 * 当场拒 —— 同时给会让人读不出哪份生效。
 */

import { TBError } from '@tool-bridge/plugin-sdk'
import {
  createProviderHttpClient,
  type ProviderHttpClientOptions,
  type ProviderHttpErrorContext,
  type ProviderHttpRequest,
  type ProviderHttpResult,
  type ProviderHttpTransportErrorContext,
} from './providerHttp'
import { type ProviderContext, requireApiKey } from './plugin'
import { asJsonObject, trimmedText } from './jsonValue'
import { upstreamError } from './upstreamError'

/**
 * 单值凭证的注入位置。三种常见头型直接声明;basic、多字段凭证、非常规 scheme
 * (`Key <key>` / `Client-ID <key>`)走 `custom`,由 provider 自己从 ctx 取凭证。
 */
export type AuthedClientAuth
  = | { readonly kind: 'bearer' }
    | { readonly headers: (ctx: ProviderContext) => HeadersInit, readonly kind: 'custom' }
    | { readonly kind: 'header', readonly name: string }
    | { readonly kind: 'token' }

/**
 * 标准错误消息提取:按序取键,全不中再用兜底。键支持点路径(`error.message`),
 * 逐段都要是对象。string 错误体(网关错误页)先整段取文,trim 后为空算未命中 ——
 * 与各 provider 手写 errorMessage 的主流语义一致;要保留“不 trim”这类偏差的
 * provider 应改用 `mapError`。
 */
export interface AuthedErrorMessage {
  /** 键全不中时的兜底(如 `statusText || \`<svc> 返回 HTTP ${status}\``);措辞逐字由 provider 定。 */
  readonly fallback: (status: number, statusText: string) => string
  readonly keys: readonly string[]
}

export interface AuthedClientOptions extends ProviderHttpClientOptions {
  readonly auth: AuthedClientAuth
  /** 标准错误提取;与 `mapError` 互斥。 */
  readonly errorMessage?: AuthedErrorMessage
  /** 每个请求都带的静态头(典型:`accept`);请求级同名头覆盖它,认证头最后写入。 */
  readonly headers?: HeadersInit
  /** 整段覆写错误映射(码表/字段级错误等);与 `errorMessage` 互斥。 */
  readonly mapError?: (context: ProviderHttpErrorContext) => TBError
  readonly mapTransportError?: (context: ProviderHttpTransportErrorContext) => TBError
}

export interface AuthedClient {
  request: <T = unknown>(ctx: ProviderContext, request: ProviderHttpRequest) => Promise<ProviderHttpResult<T>>
}

function extractErrorMessage(payload: unknown, keys: readonly string[]): string | undefined {
  const direct = trimmedText(payload)
  if (direct !== undefined) return direct
  if (asJsonObject(payload) === undefined) return undefined
  for (const key of keys) {
    let value: unknown = payload
    for (const segment of key.split('.')) {
      value = asJsonObject(value)?.[segment]
    }
    const candidate = trimmedText(value)
    if (candidate !== undefined) return candidate
  }
  return undefined
}

export function createAuthedClient(options: AuthedClientOptions): AuthedClient {
  const { auth, errorMessage, headers: staticHeaders, mapError, mapTransportError, ...clientOptions } = options
  if (errorMessage !== undefined && mapError !== undefined) {
    throw new TBError('invalid_argument', `${options.service} 不能同时声明 errorMessage 与 mapError`)
  }
  const http = createProviderHttpClient(clientOptions)
  const defaultMapError = mapError ?? (errorMessage === undefined
    ? undefined
    : ({ data, status, statusText }: ProviderHttpErrorContext) => upstreamError(
        status,
        extractErrorMessage(data, errorMessage.keys) ?? errorMessage.fallback(status, statusText),
      ))

  function authHeaders(ctx: ProviderContext): HeadersInit {
    switch (auth.kind) {
      case 'bearer':
        return { authorization: `Bearer ${requireApiKey(ctx, options.service)}` }
      case 'token':
        return { authorization: `Token ${requireApiKey(ctx, options.service)}` }
      case 'header':
        return { [auth.name]: requireApiKey(ctx, options.service) }
      case 'custom':
        return auth.headers(ctx)
    }
  }

  return {
    async request<T = unknown>(ctx: ProviderContext, request: ProviderHttpRequest): Promise<ProviderHttpResult<T>> {
      // 凭证先于请求解析:没配 authRef 要在打上游之前 fail closed(与各 provider 迁移前
      // 先调 requireApiKey 的位置一致)。
      const resolvedAuth = authHeaders(ctx)
      const headers = new Headers(staticHeaders)
      for (const [name, value] of new Headers(request.headers)) headers.set(name, value)
      for (const [name, value] of new Headers(resolvedAuth)) headers.set(name, value)
      return await http.request<T>({
        ...request,
        headers,
        mapError: request.mapError ?? defaultMapError,
        mapTransportError: request.mapTransportError ?? mapTransportError,
      })
    },
  }
}
