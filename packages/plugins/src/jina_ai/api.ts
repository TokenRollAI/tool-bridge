import type { z } from 'zod/v4'
import type { createEmbeddingsInput, rerankDocumentsInput } from './schema'
import type { ProviderContext } from '../_runtime/plugin'
import { createAuthedClient } from '../_runtime/authedClient'
import { upstreamError } from '../_runtime/upstreamError'

const SERVICE = 'jina_ai'
const REQUEST_TIMEOUT_MS = 30_000
const http = createAuthedClient({
  baseUrl: 'https://api.jina.ai/',
  service: SERVICE,
  auth: { kind: 'bearer' },
  headers: { accept: 'application/json' },
  errorMessage: {
    keys: ['detail', 'message'],
    fallback: status => `Jina AI request failed with ${status}`,
  },
  mapTransportError: ({ kind, message }) => kind === 'timeout'
    ? upstreamError(504, `Jina AI ${REQUEST_TIMEOUT_MS / 1000}s 内没有返回`)
    : upstreamError(502, `Jina AI 请求失败: ${message ?? 'unknown network error'}`),
})

async function request(ctx: ProviderContext, path: string, body: unknown): Promise<unknown> {
  const { data } = await http.request(ctx, {
    path,
    method: 'POST',
    json: body,
    timeoutMs: REQUEST_TIMEOUT_MS,
    invalidJsonMessage: 'Jina AI 返回了非 JSON 响应',
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
