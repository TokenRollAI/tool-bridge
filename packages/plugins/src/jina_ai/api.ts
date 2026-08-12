/**
 * Jina AI 的业务逻辑。
 *
 * 迁移自 open-connector `src/providers/jina_ai/executors.ts`,语义等价、写法本地化:
 * 凭证从 `ctx.upstreamAuth` 取(平台经 authRef 注入,插件不自持),出站走 `guardedFetch`,
 * 错误抛 `TBError` 七码。凭证在 **Authorization 头(`Bearer ` 前缀)**,不进 URL。
 *
 * 两个 action 是同一形状:"整个入参就是 JSON body"的 POST,只差端点路径。
 * 两处上游细节决定了这里的形状:
 * - body 先过一道 `compactObject`(丢掉值为 undefined 的键)—— `JSON.stringify` 本来就
 *   丢 undefined 值,故不再重复一遍。
 * - 上游 30s 超时,超时归 504、其余传输失败归 502;两者分开才能让调用方判断该不该重试。
 *
 * 与上游的有意偏离:
 * - 上游把 5xx 一律压成 502。这里把原始状态原样交给 `upstreamError`(原始状态更有
 *   诊断价值,且 `_runtime/upstreamError.ts` 已统一口径)。
 * - 上游错误消息直接用响应体原文;这里先试 `detail` / `message`(Jina 的错误体是
 *   `{"detail": "..."}`),拿不到再退回原文 —— 与其他迁移产物的口径一致。
 * - 上游 `mode: 'validate'` 下把 401/403 都说成 401,那条分支只服务它自己的
 *   `credentialValidators`,平台侧不需要,故不迁。
 * - 不发 `user-agent`:上游那个值(`oomol-connect/0.1`)标识的是 open-connector 进程,
 *   在这里已无意义。
 */

import type { z } from 'zod/v4'
import { TBError } from '@tool-bridge/plugin-sdk'
import type { createEmbeddingsInput, rerankDocumentsInput } from './schema'
import { type ProviderContext, requireApiKey } from '../_runtime/plugin'
import { upstreamError } from '../_runtime/upstreamError'
import { guardedFetch } from '../_runtime/guardedFetch'

const SERVICE = 'jina_ai'
const API_BASE = 'https://api.jina.ai'
/** 上游对 Jina AI 设的请求超时;超时与"上游不通"要分开归一(504 vs 502)。 */
const REQUEST_TIMEOUT_MS = 30_000

type Json = Record<string, unknown>

function record(value: unknown): Json | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Json) : undefined
}

/** 上游 `optionalString` 的等价物:非字符串、或去空白后为空,都算缺失。 */
function text(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  return trimmed === '' ? undefined : trimmed
}

function errorMessage(status: number, body: string, payload: unknown): string {
  const top = record(payload)
  return text(top?.detail)
    ?? text(top?.message)
    ?? text(body)
    ?? `Jina AI request failed with ${status}`
}

async function request(ctx: ProviderContext, path: string, body: unknown): Promise<unknown> {
  // 取凭证放在 try 外:它抛的是配置错误,不该被下面的传输失败兜底吞成 502。
  const apiKey = requireApiKey(ctx, SERVICE)

  const timeoutSignal = AbortSignal.timeout(REQUEST_TIMEOUT_MS)
  let response: Response
  try {
    response = await guardedFetch(`${API_BASE}${path}`, {
      method: 'POST',
      headers: {
        'accept': 'application/json',
        'authorization': `Bearer ${apiKey}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify(body),
      signal: timeoutSignal,
    })
  } catch (error) {
    // 传输层失败必须就地归一:漏出去的裸 Error 会被 plugin-sdk 抹成 "internal plugin error"
    // 500,把"上游不通/出网被拦"说成插件自身故障。
    if (error instanceof TBError) throw error
    if (timeoutSignal.aborted) throw upstreamError(504, `Jina AI ${REQUEST_TIMEOUT_MS / 1000}s 内没有返回`)
    const message = error instanceof Error ? error.message : 'unknown network error'
    throw upstreamError(502, `Jina AI 请求失败: ${message}`)
  }

  const raw = await response.text()
  let payload: unknown = null
  if (raw !== '') {
    try {
      payload = JSON.parse(raw)
    } catch {
      // 2xx 上回非 JSON 只能是上游坏了;错误响应上回 HTML 错误页却很常见,那时按 HTTP
      // 状态归一比报"响应不是 JSON"准得多。
      if (response.ok) {
        throw new TBError('unavailable', 'Jina AI 返回了非 JSON 响应', { retryable: true })
      }
    }
  }
  if (!response.ok) throw upstreamError(response.status, errorMessage(response.status, raw, payload))
  return payload
}

export async function createEmbeddings(
  input: z.infer<typeof createEmbeddingsInput>,
  ctx: ProviderContext,
): Promise<unknown> {
  return request(ctx, '/v1/embeddings', input)
}

export async function rerankDocuments(
  input: z.infer<typeof rerankDocumentsInput>,
  ctx: ProviderContext,
): Promise<unknown> {
  return request(ctx, '/v1/rerank', input)
}
