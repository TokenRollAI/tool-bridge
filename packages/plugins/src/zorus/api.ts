/**
 * Zorus 的业务逻辑。
 *
 * 迁移自 open-connector `src/providers/zorus/executors.ts`(它把 HTTP 层委托给共享的
 * `http-json-runtime.ts`,这里把那一层就地展开),语义等价、写法本地化:凭证从
 * `ctx.upstreamAuth` 取(平台经 authRef 注入,插件不自持),出站走 `guardedFetch`,
 * 错误抛 `TBError` 七码。
 *
 * Zorus 的形状极其统一:五个 action 都是 **POST + 整个 input 当 JSON body**,
 * 响应是**裸数组**,统一裹成 `{items}`。两个要点:
 * - 认证头是 `Impersonation <token>`,不是 `Bearer`。
 * - 版本走 `Zorus-Api-Version` 头。
 *
 * 上游 `executors.ts` 里那个 `proxy` 导出(任意端点透传)没有迁移:它不在 action 表里,
 * tool-bridge 侧也没有对应的契约位置。
 *
 * 与上游的一处偏离:共享 runtime 把 404/422 压成 400。这里把原始状态原样交给
 * `upstreamError`,收敛各 provider 互不相同的错误口径。
 */

import type { z } from 'zod/v4'
import type {
  searchActiveUnblockRequestsInput,
  searchCustomersInput,
  searchEndpointsInput,
  searchGroupsInput,
  searchPoliciesInput,
} from './schema'
import { type ProviderContext, requireApiKey } from '../_runtime/plugin'
import { upstreamError } from '../_runtime/upstreamError'
import { guardedFetch } from '../_runtime/guardedFetch'

const SERVICE = 'zorus'
const API_BASE = 'https://developer.zorustech.com'
const API_VERSION = '1.0'

type Json = Record<string, unknown>

function record(value: unknown): Json | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Json) : undefined
}

function text(value: unknown): string | undefined {
  return typeof value === 'string' && value !== '' ? value : undefined
}

/** Zorus 是 .NET 后端,错误体的键名大小写不定(`message` / `Message`),两种都试。 */
function errorMessage(payload: unknown): string | undefined {
  if (typeof payload === 'string' && payload.trim() !== '') return payload
  const body = record(payload)
  if (body === undefined) return undefined
  return text(body.message) ?? text(body.Message) ?? text(body.error) ?? text(body.Error)
    ?? text(body.detail) ?? text(body.Detail) ?? text(body.title) ?? text(body.Title)
}

/** 五个 action 共用:POST 整个 input,响应裹成 `{items}`。 */
async function search(ctx: ProviderContext, path: string, input: Json): Promise<Json> {
  // 取凭证放在 try 外:它抛的是配置错误,不该被下面的传输失败兜底吞成 502。
  const apiKey = requireApiKey(ctx, SERVICE)

  let response: Response
  try {
    response = await guardedFetch(`${API_BASE}${path}`, {
      method: 'POST',
      headers: {
        'accept': 'application/json',
        // Zorus 用的是 Impersonation 方案,不是 Bearer。
        'authorization': `Impersonation ${apiKey}`,
        'content-type': 'application/json',
        'zorus-api-version': API_VERSION,
      },
      body: JSON.stringify(input),
    })
  } catch (error) {
    // 传输层失败必须就地归一:漏出去的裸 Error 会被 plugin-sdk 抹成 "internal plugin error"
    // 500,把"上游不通/出网被拦"说成插件自身故障。
    throw upstreamError(502, error instanceof Error ? `zorus 请求失败: ${error.message}` : 'zorus 请求失败')
  }

  const raw = await response.text().catch(() => '')
  let payload: unknown = null
  if (raw.trim() !== '') {
    try {
      payload = JSON.parse(raw) as unknown
    } catch {
      throw upstreamError(502, 'Zorus 返回了非法 JSON')
    }
  }

  if (!response.ok) {
    throw upstreamError(response.status, errorMessage(payload) ?? `Zorus 请求失败,HTTP ${response.status}`)
  }
  if (!Array.isArray(payload)) throw upstreamError(502, 'Zorus 搜索结果返回了非数组响应')
  return { items: payload }
}

export function searchCustomers(
  input: z.infer<typeof searchCustomersInput>,
  ctx: ProviderContext,
): Promise<Json> {
  return search(ctx, '/api/customers/search', input)
}

export function searchEndpoints(
  input: z.infer<typeof searchEndpointsInput>,
  ctx: ProviderContext,
): Promise<Json> {
  return search(ctx, '/api/endpoints/search', input)
}

export function searchGroups(
  input: z.infer<typeof searchGroupsInput>,
  ctx: ProviderContext,
): Promise<Json> {
  return search(ctx, '/api/groups/search', input)
}

export function searchPolicies(
  input: z.infer<typeof searchPoliciesInput>,
  ctx: ProviderContext,
): Promise<Json> {
  return search(ctx, '/api/policies/search', input)
}

export function searchActiveUnblockRequests(
  input: z.infer<typeof searchActiveUnblockRequestsInput>,
  ctx: ProviderContext,
): Promise<Json> {
  return search(ctx, '/api/unblock-requests/active/search', input)
}
