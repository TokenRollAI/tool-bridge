/**
 * RealPhoneValidation 的业务逻辑。
 *
 * 迁移自 open-connector `src/providers/realphonevalidation/executors.ts`,语义等价、
 * 写法本地化:凭证从 `ctx.upstreamAuth` 取,出站走 `guardedFetch`,错误抛 `TBError` 七码。
 *
 * 这个上游有两处必须照搬的怪异:
 * - **凭证进 URL**(`?token=<key>`),没有 header 形式;
 * - 失败大多以 **HTTP 200 + status 字段** 表达("unauthorized"、"invalid-phone"、
 *   "server-unavailable"…),所以状态码通过之后还要再看一遍响应体。
 *   另外 HTTP 403 在这里表示**限流**而非无权,故映射成 rate_limited。
 */

import type { z } from 'zod/v4'
import { TBError } from '@tool-bridge/plugin-sdk'
import type { validatePhoneStandardInput, validatePhoneV3Input } from './schema'
import { type ProviderContext, requireApiKey } from '../_runtime/plugin'
import { upstreamError } from '../_runtime/upstreamError'
import { guardedFetch } from '../_runtime/guardedFetch'

const SERVICE = 'realphonevalidation'
const API_BASE = 'https://api.realvalidation.com'
const TURBO_STANDARD_PATH = '/rpvWebService/Turbo.php'
const TURBO_V3_PATH = '/rpvWebService/TurboV3.php'

type Json = Record<string, unknown>

function text(value: unknown): string | undefined {
  return typeof value === 'string' ? value.trim() || undefined : undefined
}

function record(value: unknown): Json | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Json : undefined
}

/** error_text 有时是空对象 `{}` 而非字符串;两种"没有错误"都归成 null。 */
function errorText(value: unknown): string | null {
  return text(value) ?? null
}

/** HTTP 200 的响应体里仍可能是失败,按 status/error_text 分流成七码。 */
function normalize(payload: Json, includeEnrichment: boolean): Json {
  const status = text(payload.status)
  const error = errorText(payload.error_text)
  if (status === undefined) {
    throw new TBError('unavailable', 'RealPhoneValidation 响应缺少 status 字段', { retryable: true })
  }

  const normalized = status.toLowerCase()
  if (normalized === 'unauthorized' || error === 'token is not valid') {
    throw new TBError('permission_denied', error ?? 'token is not valid')
  }
  if (
    normalized === 'invalid-format'
    || normalized === 'invalid-phone'
    || (normalized === 'error' && (error === 'bad phone number' || error === 'missing token'))
  ) {
    throw new TBError('invalid_argument', error ?? status)
  }
  if (normalized === 'server-unavailable') {
    throw new TBError('unavailable', error ?? status, { retryable: true })
  }

  const output: Json = {
    status,
    error_text: error,
    phone_type: text(payload.phone_type) ?? null,
  }
  // 只有 Turbo v3 端点会回这三个富化字段;Standard 的出参 schema 里没有它们。
  if (includeEnrichment) {
    output.caller_name = text(payload.caller_name) ?? null
    output.carrier = text(payload.carrier) ?? null
    output.caller_type = text(payload.caller_type) ?? null
  }
  return output
}

async function request(
  ctx: ProviderContext,
  path: string,
  phone: string,
  includeEnrichment: boolean,
): Promise<Json> {
  const url = new URL(`${API_BASE}${path}`)
  url.searchParams.set('output', 'json')
  url.searchParams.set('phone', phone)
  url.searchParams.set('token', requireApiKey(ctx, SERVICE))

  const response = await guardedFetch(url.toString(), {
    method: 'GET',
    headers: { accept: 'application/json' },
  })

  const raw = await response.text()
  let payload: unknown = null
  if (raw !== '') {
    try {
      payload = JSON.parse(raw)
    } catch {
      // 上游在异常路径上会回纯文本;留着当错误消息用。
      payload = raw
    }
  }

  if (response.status === 403) {
    throw new TBError(
      'rate_limited',
      'RealPhoneValidation temporarily throttled the request after exceeding the recommended rate limit.',
      { retryable: true },
    )
  }
  if (!response.ok) {
    const object = record(payload)
    const message = text(payload)
      ?? errorText(object?.error_text)
      ?? text(object?.status)
      ?? `RealPhoneValidation request failed with HTTP ${response.status}`
    throw upstreamError(response.status, message)
  }

  const object = record(payload)
  if (object === undefined) {
    throw new TBError('unavailable', `RealPhoneValidation ${path} 返回了非对象响应`, { retryable: true })
  }
  return normalize(object, includeEnrichment)
}

export function validatePhoneStandard(
  input: z.infer<typeof validatePhoneStandardInput>,
  ctx: ProviderContext,
): Promise<Json> {
  // schema 把 phone 标成 optional;上游在缺它时照样发空串,让服务端回 "bad phone number"。
  return request(ctx, TURBO_STANDARD_PATH, input.phone ?? '', false)
}

export function validatePhoneV3(
  input: z.infer<typeof validatePhoneV3Input>,
  ctx: ProviderContext,
): Promise<Json> {
  return request(ctx, TURBO_V3_PATH, input.phone ?? '', true)
}
