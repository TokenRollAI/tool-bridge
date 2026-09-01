import type { z } from 'zod/v4'
import type { chatInput, embedTextsInput, rerankDocumentsInput } from './schema'
import type { ProviderContext } from '../_runtime/plugin'
import {
  asJsonObject,
  type JsonObject,
  nonEmptyText,
} from '../_runtime/providerHttp'
import { createAuthedClient } from '../_runtime/authedClient'
import { upstreamError } from '../_runtime/upstreamError'

const SERVICE = 'cohere'

function errorMessage(payload: unknown, status: number): string {
  const fallback = nonEmptyText(payload) ?? `cohere request failed with ${status}`
  const root = asJsonObject(payload)
  return nonEmptyText(asJsonObject(root?.error)?.message)
    ?? nonEmptyText(root?.message)
    ?? fallback
}

const http = createAuthedClient({
  baseUrl: 'https://api.cohere.com/',
  service: SERVICE,
  auth: { kind: 'bearer' },
  headers: { accept: 'application/json' },
  // 498 是 Cohere 表达"token 无效"的私有码,改判 401 让它落 permission_denied。
  mapError: ({ data: payload, status }) => upstreamError(
    status === 498 ? 401 : status,
    errorMessage(payload, status),
  ),
})

async function post(ctx: ProviderContext, path: string, body: object): Promise<JsonObject> {
  const { data } = await http.request(ctx, {
    path,
    method: 'POST',
    json: body,
    invalidJsonMessage: 'cohere returned an invalid JSON response',
  })
  const result = asJsonObject(data)
  if (result === undefined) throw upstreamError(502, 'cohere returned an invalid JSON response')
  return result
}

export function chat(input: z.infer<typeof chatInput>, ctx: ProviderContext): Promise<JsonObject> {
  return post(ctx, 'v2/chat', input)
}

export function embedTexts(
  input: z.infer<typeof embedTextsInput>,
  ctx: ProviderContext,
): Promise<JsonObject> {
  return post(ctx, 'v2/embed', input)
}

export function rerankDocuments(
  input: z.infer<typeof rerankDocumentsInput>,
  ctx: ProviderContext,
): Promise<JsonObject> {
  return post(ctx, 'v2/rerank', input)
}
