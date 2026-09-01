import type { z } from 'zod/v4'
import type { identifyUserInput, mutateInsightInput, publishEventInput, publishInsightInput } from './schema'
import type { ProviderContext } from '../_runtime/plugin'
import { createAuthedClient } from '../_runtime/authedClient'

const SERVICE = 'logsnag'
const http = createAuthedClient({
  baseUrl: 'https://api.logsnag.com/v1/',
  service: SERVICE,
  auth: { kind: 'bearer' },
  headers: { accept: 'application/json' },
  errorMessage: {
    keys: ['message', 'error', 'detail'],
    fallback: status => `LogSnag request failed with ${status}`,
  },
})

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
  const result = await http.request(ctx, {
    path,
    method,
    json: body,
    responseType: 'auto',
    invalidJson: 'text',
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
