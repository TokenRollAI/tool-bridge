import type { z } from 'zod/v4'
import { TBError } from '@tool-bridge/plugin-sdk'
import type { sendEmailInput } from './schema.handwritten'
import type { ProviderContext } from '../_runtime/plugin'
import { asJsonObject, nonEmptyText } from '../_runtime/providerHttp'
import { createAuthedClient } from '../_runtime/authedClient'
import { upstreamError } from '../_runtime/upstreamError'

const SERVICE = 'resend'
const AUTH_ERROR_NAMES = new Set(['invalid_api_key', 'missing_api_key'])

function payloadOf(data: unknown): Record<string, unknown> {
  return asJsonObject(data) ?? (typeof data === 'string' ? { message: data } : {})
}

function resendError(status: number, data: unknown): TBError {
  const payload = payloadOf(data)
  const name = nonEmptyText(payload.name) ?? nonEmptyText(payload.error) ?? 'provider_error'
  const message = nonEmptyText(payload.message)
    ?? nonEmptyText(payload.error_description)
    ?? `Resend 返回 HTTP ${status}`
  return AUTH_ERROR_NAMES.has(name)
    ? new TBError('permission_denied', message, { httpStatus: 401 })
    : upstreamError(status, message)
}

const http = createAuthedClient({
  baseUrl: 'https://api.resend.com/',
  service: SERVICE,
  auth: { kind: 'bearer' },
  // 错误码表(invalid_api_key 等改判 permission_denied),整段覆写而不用标准键序提取。
  mapError: ({ data: payload, status }) => resendError(status, payload),
})

export async function sendEmail(
  input: z.infer<typeof sendEmailInput>,
  ctx: ProviderContext,
): Promise<{ emailId: string }> {
  const { data } = await http.request(ctx, {
    path: 'emails',
    method: 'POST',
    json: {
      from: input.from,
      to: input.to,
      subject: input.subject,
      ...(input.html === undefined ? {} : { html: input.html }),
      ...(input.text === undefined ? {} : { text: input.text }),
    },
    invalidJson: 'text',
  })

  const emailId = nonEmptyText(payloadOf(data).id)
  if (emailId === undefined) {
    throw new TBError('unavailable', 'Resend 的成功响应里没有 email id', { retryable: true })
  }
  return { emailId }
}
