/**
 * Resend 的业务逻辑。
 *
 * 迁移自 open-connector `src/providers/resend/executors.ts`,语义等价、写法本地化:
 * 凭证从 `ctx.upstreamAuth` 取,出站走 `guardedFetch`,错误抛 `TBError` 七码。
 *
 * Resend 的错误体是 `{name, message}`,其中 `name` 是稳定的错误名(`invalid_api_key`、
 * `missing_api_key` 等)。它比 HTTP 状态更准 —— Resend 对无效 key 回的是 4xx 但不总是 401,
 * 故这里先看 `name` 再退回状态码。
 */

import type { z } from 'zod/v4'
import { TBError } from '@tool-bridge/plugin-sdk'
import type { sendEmailInput } from './schema.handwritten'
import { type ProviderContext, requireApiKey } from '../_runtime/plugin'
import { upstreamError } from '../_runtime/upstreamError'
import { guardedFetch } from '../_runtime/guardedFetch'

const SERVICE = 'resend'
const API_BASE = 'https://api.resend.com'

/** Resend 认证失败时用的稳定错误名(比 HTTP 状态更准)。 */
const AUTH_ERROR_NAMES = new Set(['invalid_api_key', 'missing_api_key'])

/** 响应体尽力解析成对象:Resend 在边缘错误上可能回空体或纯文本。 */
async function readPayload(response: Response): Promise<Record<string, unknown>> {
  const text = await response.text().catch(() => '')
  if (text === '') return {}
  try {
    const parsed: unknown = JSON.parse(text)
    return parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {}
  } catch {
    return { message: text }
  }
}

function text(value: unknown): string | undefined {
  return typeof value === 'string' && value !== '' ? value : undefined
}

/** Resend 错误 → TBError。先看稳定错误名,再退回状态码归一。 */
function resendError(status: number, payload: Record<string, unknown>): TBError {
  const name = text(payload.name) ?? text(payload.error) ?? 'provider_error'
  const message = text(payload.message)
    ?? text(payload.error_description)
    ?? `Resend 返回 HTTP ${status}`
  if (AUTH_ERROR_NAMES.has(name)) {
    return new TBError('permission_denied', message, { httpStatus: 401 })
  }
  return upstreamError(status, message)
}

export async function sendEmail(
  input: z.infer<typeof sendEmailInput>,
  ctx: ProviderContext,
): Promise<{ emailId: string }> {
  const response = await guardedFetch(`${API_BASE}/emails`, {
    method: 'POST',
    headers: {
      'authorization': `Bearer ${requireApiKey(ctx, SERVICE)}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      from: input.from,
      to: input.to,
      subject: input.subject,
      ...(input.html === undefined ? {} : { html: input.html }),
      ...(input.text === undefined ? {} : { text: input.text }),
    }),
  })

  const payload = await readPayload(response)
  if (!response.ok) throw resendError(response.status, payload)

  const emailId = text(payload.id)
  if (emailId === undefined) {
    // 上游说成功了却没给 id:契约破了,不是调用方的错。
    throw new TBError('unavailable', 'Resend 的成功响应里没有 email id', { retryable: true })
  }
  return { emailId }
}
