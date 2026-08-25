import type { z } from 'zod/v4'
import type { createEmbeddingsInput, rerankDocumentsInput } from './schema'
import { createProviderHttpClient, messageFrom } from '../_runtime/providerHttp'
import { type ProviderContext, requireApiKey } from '../_runtime/plugin'
import { upstreamError } from '../_runtime/upstreamError'

const SERVICE = 'jina_ai'
const REQUEST_TIMEOUT_MS = 30_000
const http = createProviderHttpClient({ baseUrl: 'https://api.jina.ai/', service: SERVICE })

async function request(ctx: ProviderContext, path: string, body: unknown): Promise<unknown> {
  const { data } = await http.request({
    path,
    method: 'POST',
    headers: {
      accept: 'application/json',
      authorization: `Bearer ${requireApiKey(ctx, SERVICE)}`,
    },
    json: body,
    timeoutMs: REQUEST_TIMEOUT_MS,
    invalidJsonMessage: 'Jina AI 返回了非 JSON 响应',
    mapError: ({ data: payload, status }) => upstreamError(
      status,
      messageFrom(payload, ['detail', 'message'], `Jina AI request failed with ${status}`),
    ),
    mapTransportError: ({ kind, message }) => kind === 'timeout'
      ? upstreamError(504, `Jina AI ${REQUEST_TIMEOUT_MS / 1000}s 内没有返回`)
      : upstreamError(502, `Jina AI 请求失败: ${message ?? 'unknown network error'}`),
  })
  return data ?? null
}

export function createEmbeddings(
  input: z.infer<typeof createEmbeddingsInput>,
  ctx: ProviderContext,
): Promise<unknown> {
  return request(ctx, 'v1/embeddings', input)
}

export function rerankDocuments(
  input: z.infer<typeof rerankDocumentsInput>,
  ctx: ProviderContext,
): Promise<unknown> {
  return request(ctx, 'v1/rerank', input)
}
