/**
 * Appstle Subscriptions 的业务逻辑。
 *
 * 迁移自 open-connector `src/providers/appstle_subscriptions/executors.ts`,语义等价、
 * 写法本地化:凭证从 `ctx.upstreamAuth` 取,出站走 `guardedFetch`,错误抛 `TBError` 七码。
 *
 * Appstle 的形状特点:
 * - 凭证走 **`X-API-Key` 头**。
 * - 后端是 Spring,列表分页用 `page`/`size`/`sort`(`sort` 可重复,形如 `id,desc`)。
 * - 四个 action 全是 GET,响应直接是数组或对象(没有 envelope),故各自就地整形。
 *
 * 一处**没有照搬**的地方:上游 `createAppstleSubscriptionsError` 把 404 压成 400。
 * 本仓库的错误口径收在共用的 `upstreamError` 里(见其文件头注释),故 404 归 not_found,
 * 让调用方能区分"传错了参数"和"这个客户不存在"。
 */

import type { z } from 'zod/v4'
import { TBError } from '@tool-bridge/plugin-sdk'
import type {
  getCustomerWithSubscriptionsInput,
  getValidSubscriptionContractIdsInput,
  listCustomerSubscriptionDetailsInput,
  listCustomersWithSubscriptionsInput,
} from './schema'
import { type ProviderContext, requireApiKey } from '../_runtime/plugin'
import { upstreamError } from '../_runtime/upstreamError'
import { guardedFetch } from '../_runtime/guardedFetch'

const SERVICE = 'appstle_subscriptions'
const API_BASE = 'https://subscription-admin.appstle.com'
/** 上游 buildListCustomersSearchParams 里写死的分页兜底值。 */
const DEFAULT_PAGE = 0
const DEFAULT_SIZE = 25

type Json = Record<string, unknown>

function text(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  return trimmed === '' ? undefined : trimmed
}

/** Appstle 的错误文案散在五个字段里,顺序照搬上游;整个 body 也可能就是一段纯文本。 */
function errorMessage(payload: unknown, statusText: string): string {
  const direct = text(payload)
  if (direct !== undefined) return direct

  const record = typeof payload === 'object' && payload !== null && !Array.isArray(payload)
    ? (payload as Json)
    : {}
  return text(record.message) ?? text(record.error) ?? text(record.detail)
    ?? text(record.title) ?? text(record.path)
    ?? text(statusText) ?? 'Appstle Subscriptions request failed'
}

async function readPayload(response: Response): Promise<unknown> {
  const body = await response.text().catch(() => '')
  if (body.trim() === '') return null
  try {
    return JSON.parse(body) as unknown
  } catch {
    return body
  }
}

async function request(
  ctx: ProviderContext,
  path: string,
  query: Array<[string, string]> = [],
): Promise<unknown> {
  const url = new URL(path, API_BASE)
  for (const [key, value] of query) url.searchParams.append(key, value)

  let response: Response
  try {
    response = await guardedFetch(url.toString(), {
      method: 'GET',
      headers: {
        'accept': 'application/json',
        'X-API-Key': requireApiKey(ctx, SERVICE),
      },
    })
  } catch (error) {
    if (error instanceof TBError) throw error
    throw new TBError(
      'unavailable',
      error instanceof Error
        ? `Appstle Subscriptions 请求失败: ${error.message}`
        : 'Appstle Subscriptions 请求失败',
      { retryable: true },
    )
  }

  const payload = await readPayload(response)
  if (!response.ok) throw upstreamError(response.status || 500, errorMessage(payload, response.statusText))
  return payload
}

/** 上游对非数组响应一律降级成空数组,不报错 —— 保留:少数端点在无数据时回 null。 */
function asArray(payload: unknown): unknown[] {
  return Array.isArray(payload) ? payload : []
}

export async function listCustomersWithSubscriptions(
  input: z.infer<typeof listCustomersWithSubscriptionsInput>,
  ctx: ProviderContext,
): Promise<Json> {
  const query: Array<[string, string]> = []
  if (input.name !== undefined) query.push(['name', input.name])
  if (input.email !== undefined) query.push(['email', input.email])
  if (input.activeMoreThanOneSubscription !== undefined) {
    query.push(['activeMoreThanOneSubscription', String(input.activeMoreThanOneSubscription)])
  }
  // page/size 上游总是发(省略时补默认值),不是"省略即不传"。
  query.push(['page', String(input.page ?? DEFAULT_PAGE)])
  query.push(['size', String(input.size ?? DEFAULT_SIZE)])
  for (const item of input.sort ?? []) query.push(['sort', item])

  const payload = await request(ctx, '/api/external/v2/subscription-contract-details/customers', query)
  return { customers: asArray(payload) }
}

export async function getCustomerWithSubscriptions(
  input: z.infer<typeof getCustomerWithSubscriptionsInput>,
  ctx: ProviderContext,
): Promise<Json> {
  const query: Array<[string, string]> = input.cursor === undefined ? [] : [['cursor', input.cursor]]
  const payload = await request(
    ctx,
    `/api/external/v2/subscription-customers/${input.customerId}`,
    query,
  )
  return { customer: payload ?? null }
}

export async function getValidSubscriptionContractIds(
  input: z.infer<typeof getValidSubscriptionContractIdsInput>,
  ctx: ProviderContext,
): Promise<Json> {
  const payload = await request(ctx, `/api/external/v2/subscription-customers/valid/${input.customerId}`)
  // 上游只留整数项:这个端点偶尔混进字符串形态的 id,出参 schema 声明的是 int。
  const contractIds = asArray(payload)
    .filter((item): item is number => typeof item === 'number' && Number.isInteger(item))
  return { contractIds }
}

export async function listCustomerSubscriptionDetails(
  input: z.infer<typeof listCustomerSubscriptionDetailsInput>,
  ctx: ProviderContext,
): Promise<Json> {
  const payload = await request(
    ctx,
    `/api/external/v2/subscription-customers-detail/valid/${input.customerId}`,
  )
  return { subscriptions: asArray(payload) }
}
