/**
 * 知乎开放平台的业务逻辑。
 *
 * 迁移自 open-connector `src/providers/zhihu/executors.ts`,语义等价、写法本地化:
 * 凭证从 `ctx.upstreamAuth` 取(平台经 authRef 注入,插件不自持),出站走 `guardedFetch`,
 * 错误抛 `TBError` 七码。
 *
 * 知乎的两个特点决定了这里的形状:
 * - query 键是**大驼峰**(`Query` / `Count` / `Limit` / `Filter` / `SearchDB`),与入参的
 *   小驼峰字段不同名,所以每个 action 都得显式映射,不能整包透传。
 * - **HTTP 200 不代表成功**:响应体里还有一层业务码 `Code`,非 0 即失败。只看状态码会把
 *   限流和凭证失效当成正常返回,把错误体喂给调用方。上游为此单独映射 `Code`,这里保留。
 *
 * 上游 `createZhihuHttpError` 里"把 404 压成 400、把 403 压成 401"的分支不保留:
 * 状态码归一由共用的 `upstreamError` 统一口径。
 */

import type { z } from 'zod/v4'
import { TBError } from '@tool-bridge/plugin-sdk'
import type { globalSearchInput, hotListInput, zhidaInput, zhihuSearchInput } from './schema'
import { asJsonObject as asRecord, trimmedText as optionalText } from '../_runtime/jsonValue'
import { type ProviderContext, requireApiKey } from '../_runtime/plugin'
import { createProviderHttpClient } from '../_runtime/providerHttp'
import { upstreamError } from '../_runtime/upstreamError'

const SERVICE = 'zhihu'
const API_BASE = 'https://developer.zhihu.com'
const http = createProviderHttpClient({ baseUrl: `${API_BASE}/`, service: SERVICE })

/** 知乎业务码 → 用于归一的 HTTP 状态。上游的口径,照搬;表外的非 0 码一律当上游故障。 */
const CODE_STATUS: Record<number, number> = {
  10001: 400,
  20001: 401,
  30001: 429,
}

type Json = Record<string, unknown>

/** 知乎的错误消息散落在四个位置,逐个试。 */
function errorMessage(payload: unknown): string | undefined {
  const direct = optionalText(payload)
  if (direct !== undefined) return direct
  const record = asRecord(payload)
  if (record === undefined) return undefined
  const nested = asRecord(record.error)
  return optionalText(record.Message)
    ?? optionalText(record.msg)
    ?? optionalText(record.message)
    ?? optionalText(nested?.message)
}

interface RequestInput {
  body?: Json
  method?: 'GET' | 'POST'
  path: string
  query?: Record<string, unknown>
}

async function request(ctx: ProviderContext, input: RequestInput): Promise<unknown> {
  const apiKey = requireApiKey(ctx, SERVICE)
  const response = await http.request({
    method: input.method ?? 'GET',
    path: input.path,
    query: Object.entries(input.query ?? {}).map(([key, value]) => [key, value === undefined ? undefined : String(value)]),
    headers: {
      'authorization': `Bearer ${apiKey}`,
      // 上游对 GET 也发这个头。无 body 时它没有意义,但照搬以免改变打给上游的请求形状。
      'content-type': 'application/json',
      'x-request-timestamp': String(Math.floor(Date.now() / 1000)),
    },
    ...(input.body === undefined ? {} : { json: input.body }),
    invalidJsonMessage: '知乎返回了非法 JSON',
    mapError: ({ bodyKind, data, status }) => bodyKind === 'invalid-json'
      ? upstreamError(502, '知乎返回了非法 JSON')
      : upstreamError(status, errorMessage(data) ?? `知乎请求失败(HTTP ${status})`),
    mapTransportError: ({ message }) => upstreamError(
      502,
      message === undefined ? '知乎请求失败' : `知乎请求失败: ${message}`,
    ),
  })
  const payload = response.bodyKind === 'empty' ? {} : response.data

  const code = asRecord(payload)?.Code
  if (typeof code === 'number' && Number.isFinite(code) && code !== 0) {
    throw upstreamError(
      CODE_STATUS[code] ?? 502,
      errorMessage(payload) ?? `知乎返回业务码 ${code}`,
    )
  }
  return payload
}

export async function zhihuSearch(
  input: z.infer<typeof zhihuSearchInput>,
  ctx: ProviderContext,
): Promise<unknown> {
  return request(ctx, {
    path: '/api/v1/content/zhihu_search',
    query: { Query: input.query, Count: input.count },
  })
}

export async function globalSearch(
  input: z.infer<typeof globalSearchInput>,
  ctx: ProviderContext,
): Promise<unknown> {
  return request(ctx, {
    path: '/api/v1/content/global_search',
    query: {
      Query: input.query,
      Count: input.count,
      Filter: input.filter,
      SearchDB: input.searchDB,
    },
  })
}

export async function hotList(
  input: z.infer<typeof hotListInput>,
  ctx: ProviderContext,
): Promise<unknown> {
  return request(ctx, {
    path: '/api/v1/content/hot_list',
    query: { Limit: input.limit },
  })
}

export async function zhida(
  input: z.infer<typeof zhidaInput>,
  ctx: ProviderContext,
): Promise<unknown> {
  // 上游把 model / messages 声明为必填,生成出来的 schema 却把两者放成了 optional
  // (生成器对"没有 optional 列表的 s.object"整体判为可选)。schema.ts 不归本次改动管,
  // 故在这里补回上游的必填语义 —— 否则空参调用会带着无意义的 body 打到知乎再 400。
  if (input.model === undefined) {
    throw new TBError('invalid_argument', 'zhida 需要 model')
  }
  if (input.messages === undefined || input.messages.length === 0) {
    throw new TBError('invalid_argument', 'zhida 需要至少一条 messages')
  }
  return request(ctx, {
    method: 'POST',
    path: '/v1/chat/completions',
    // stream 恒为 false:本 action 的出参契约是一次性返回完整 completion,
    // 平台侧也没有把 SSE 流透出去的通道。
    body: { ...input, stream: false },
  })
}
