import type { z } from 'zod/v4'
import type { chatInput, embedTextsInput, rerankDocumentsInput } from './schema'
import {
  asJsonObject,
  createProviderHttpClient,
  type JsonObject,
  nonEmptyText,
} from '../_runtime/providerHttp'
import { type ProviderContext, requireApiKey } from '../_runtime/plugin'
import { upstreamError } from '../_runtime/upstreamError'

const SERVICE = 'cohere'
const http = createProviderHttpClient({ baseUrl: 'https://api.cohere.com/', service: SERVICE })

function errorMessage(payload: unknown, status: number): string {
  const fallback = nonEmptyText(payload) ?? `cohere request failed with ${status}`
  const root = asJsonObject(payload)
  return nonEmptyText(asJsonObject(root?.error)?.message)
    ?? nonEmptyText(root?.message)
    ?? fallback
}

async function post(ctx: ProviderContext, path: string, body: object): Promise<JsonObject> {
  const { data } = await http.request({
    path,
    method: 'POST',
    headers: {
      accept: 'application/json',
      authorization: `Bearer ${requireApiKey(ctx, SERVICE)}`,
    },
    json: body,
    invalidJsonMessage: 'cohere returned an invalid JSON response',
    mapError: ({ data: payload, status }) => upstreamError(
      status === 498 ? 401 : status,
      errorMessage(payload, status),
    ),
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
