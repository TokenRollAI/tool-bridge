import type { z } from 'zod/v4'
import type { identifyUserInput, mutateInsightInput, publishEventInput, publishInsightInput } from './schema'
import { createProviderHttpClient, messageFrom } from '../_runtime/providerHttp'
import { type ProviderContext, requireApiKey } from '../_runtime/plugin'
import { upstreamError } from '../_runtime/upstreamError'

const SERVICE = 'logsnag'
const http = createProviderHttpClient({ baseUrl: 'https://api.logsnag.com/v1/', service: SERVICE })

interface LogsnagResult {
  ok: true
  payload?: unknown
  status: number
}

async function request(
  path: string,
  method: 'PATCH' | 'POST',
  body: Record<string, unknown>,
  ctx: ProviderContext,
): Promise<LogsnagResult> {
  const result = await http.request({
    path,
    method,
    headers: {
      accept: 'application/json',
      authorization: `Bearer ${requireApiKey(ctx, SERVICE)}`,
    },
    json: body,
    responseType: 'auto',
    invalidJson: 'text',
    mapError: ({ data, status }) => upstreamError(
      status,
      messageFrom(data, ['message', 'error', 'detail'], `LogSnag request failed with ${status}`),
    ),
  })
  return {
    ok: true,
    status: result.status,
    ...(result.data === undefined ? {} : { payload: result.data }),
  }
}

export function publishEvent(
  input: z.infer<typeof publishEventInput>,
  ctx: ProviderContext,
): Promise<LogsnagResult> {
  return request('log', 'POST', input, ctx)
}

export function identifyUser(
  input: z.infer<typeof identifyUserInput>,
  ctx: ProviderContext,
): Promise<LogsnagResult> {
  return request('identify', 'POST', input, ctx)
}

export function publishInsight(
  input: z.infer<typeof publishInsightInput>,
  ctx: ProviderContext,
): Promise<LogsnagResult> {
  return request('insight', 'POST', input, ctx)
}

export function mutateInsight(
  input: z.infer<typeof mutateInsightInput>,
  ctx: ProviderContext,
): Promise<LogsnagResult> {
  return request('insight', 'PATCH', input, ctx)
}
