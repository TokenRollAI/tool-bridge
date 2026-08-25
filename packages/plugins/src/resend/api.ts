import type { z } from 'zod/v4'
import { TBError } from '@tool-bridge/plugin-sdk'
import type { sendEmailInput } from './schema.handwritten'
import { asJsonObject, createProviderHttpClient, nonEmptyText } from '../_runtime/providerHttp'
import { type ProviderContext, requireApiKey } from '../_runtime/plugin'
import { upstreamError } from '../_runtime/upstreamError'

const SERVICE = 'resend'
const AUTH_ERROR_NAMES = new Set(['invalid_api_key', 'missing_api_key'])
const http = createProviderHttpClient({ baseUrl: 'https://api.resend.com/', service: SERVICE })

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

export async function sendEmail(
  input: z.infer<typeof sendEmailInput>,
  ctx: ProviderContext,
): Promise<{ emailId: string }> {
  const { data } = await http.request({
    path: 'emails',
    method: 'POST',
    headers: { authorization: `Bearer ${requireApiKey(ctx, SERVICE)}` },
    json: {
      from: input.from,
      to: input.to,
      subject: input.subject,
      ...(input.html === undefined ? {} : { html: input.html }),
      ...(input.text === undefined ? {} : { text: input.text }),
    },
    invalidJson: 'text',
    mapError: ({ data: payload, status }) => resendError(status, payload),
  })

  const emailId = nonEmptyText(payloadOf(data).id)
  if (emailId === undefined) {
    throw new TBError('unavailable', 'Resend 的成功响应里没有 email id', { retryable: true })
  }
  return { emailId }
}
