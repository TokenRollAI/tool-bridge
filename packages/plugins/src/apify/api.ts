/**
 * Apify 的业务逻辑。
 *
 * 迁移自 open-connector `src/providers/apify/executors.ts`,语义等价、写法本地化:
 * 凭证从 `ctx.upstreamAuth` 取,出站走 `guardedFetch`,错误抛 `TBError` 七码。
 *
 * Apify 的两个特点决定了这里的形状:
 * - 大多数响应包在 `{data: ...}` 里,但**不是全部**(dataset items 直接是裸数组),
 *   所以拆包要看 `data` 在不在,而不能无条件取。
 * - 布尔类 query 参数要传 **1/0**,不是 `true`/`false`。
 *
 * 上游 `notFoundAsInvalidInput` 那条(404 在执行阶段也归成 401)没有搬:
 * 「actor 不存在」与「凭证无权」对调用方是两件事,前者重试再多次也不会好,
 * 后者要换凭证。这里让 404 落在 not_found。
 */

import type { z } from 'zod/v4'
import { TBError } from '@tool-bridge/plugin-sdk'
import type {
  getActorInput,
  getDatasetItemsInput,
  getRunInput,
  runActorInput,
} from './schema'
import { type ProviderContext, requireApiKey } from '../_runtime/plugin'
import { createProviderHttpClient } from '../_runtime/providerHttp'
import { asJsonObject as asRecord } from '../_runtime/jsonValue'
import { upstreamError } from '../_runtime/upstreamError'

const SERVICE = 'apify'
const API_BASE = 'https://api.apify.com'
const CURRENT_USER_PATH = '/v2/users/me'
const http = createProviderHttpClient({ baseUrl: `${API_BASE}/`, service: SERVICE })

type Json = Record<string, unknown>

interface RequestInput {
  body?: Json
  method?: 'GET' | 'POST'
  query?: Record<string, number | string | undefined>
}

function nonEmpty(value: unknown): string | undefined {
  return typeof value === 'string' && value !== '' ? value : undefined
}

/** Apify 的错误文案在 `error.message`,少数端点用顶层 `message` 或 `error.type`。 */
function errorMessage(payload: unknown, status: number): string {
  const record = asRecord(payload)
  const error = asRecord(record?.error)
  return nonEmpty(error?.message)
    ?? nonEmpty(record?.message)
    ?? nonEmpty(error?.type)
    ?? `Apify request failed with status ${status}`
}

/**
 * 生成的 schema 把 get_actor 的 actorId 标成了 optional(上游 action 定义如此),
 * 但上游 handler 一律 `requiredString(...)`。在本地挡住,免得拼出 `/acts/undefined`。
 */
function requiredId(value: string | undefined, field: string): string {
  if (value === undefined || value === '') {
    throw new TBError('invalid_argument', `${field} 不能为空`)
  }
  return encodeURIComponent(value)
}

async function request(ctx: ProviderContext, path: string, init: RequestInput = {}): Promise<unknown> {
  const { data } = await http.request({
    path,
    method: init.method ?? 'GET',
    query: Object.entries(init.query ?? {}),
    headers: {
      accept: 'application/json',
      authorization: `Bearer ${requireApiKey(ctx, SERVICE)}`,
    },
    ...(init.body === undefined ? {} : { json: init.body }),
    invalidJsonMessage: 'Apify 返回了非 JSON 响应',
    mapError: ({ bodyKind, data: payload, status }) => bodyKind === 'invalid-json'
      ? new TBError('unavailable', 'Apify 返回了非 JSON 响应', { retryable: true })
      : upstreamError(status, errorMessage(payload, status)),
    mapTransportError: ({ message }) => new TBError(
      'unavailable',
      message === undefined ? 'Apify 请求失败' : `Apify 请求失败: ${message}`,
      { retryable: true },
    ),
  })
  return data ?? null
}

/** `{data: ...}` 包裹存在时拆一层,不存在就是响应本身(上游两种形状都见过)。 */
function unwrap(payload: unknown, label: string): Json {
  const record = asRecord(payload)
  if (record === undefined) {
    throw new TBError('unavailable', `Apify 的${label}响应不是对象`, { retryable: true })
  }
  if (!Object.prototype.hasOwnProperty.call(record, 'data')) return record
  const data = asRecord(record.data)
  if (data === undefined) {
    throw new TBError('unavailable', `Apify 的${label}响应 data 不是对象`, { retryable: true })
  }
  return data
}

/** Apify 的布尔 query 参数认 1/0,传 'true' 不生效。 */
function flag(value: boolean | undefined): number | undefined {
  return value === undefined ? undefined : (value ? 1 : 0)
}

export async function getCurrentUser(_input: unknown, ctx: ProviderContext): Promise<Json> {
  return { user: unwrap(await request(ctx, CURRENT_USER_PATH), 'user') }
}

export async function getActor(
  input: z.infer<typeof getActorInput>,
  ctx: ProviderContext,
): Promise<Json> {
  const payload = await request(ctx, `/v2/acts/${requiredId(input.actorId, 'actorId')}`)
  return { actor: unwrap(payload, 'actor') }
}

export async function runActor(
  input: z.infer<typeof runActorInput>,
  ctx: ProviderContext,
): Promise<Json> {
  const payload = await request(ctx, `/v2/acts/${encodeURIComponent(input.actorId)}/runs`, {
    method: 'POST',
    // 上游即使没给 input 也发一个空对象体(Apify 要求 POST 带 JSON body)。
    body: input.input ?? {},
    query: {
      build: input.build,
      memory: input.memoryMbytes,
      timeout: input.timeoutSecs,
    },
  })
  return { run: unwrap(payload, 'run') }
}

export async function getRun(
  input: z.infer<typeof getRunInput>,
  ctx: ProviderContext,
): Promise<Json> {
  const payload = await request(ctx, `/v2/actor-runs/${encodeURIComponent(input.runId)}`, {
    query: { waitForFinish: input.waitForFinishSeconds },
  })
  return { run: unwrap(payload, 'run') }
}

export async function getDatasetItems(
  input: z.infer<typeof getDatasetItemsInput>,
  ctx: ProviderContext,
): Promise<Json> {
  const payload = await request(ctx, `/v2/datasets/${encodeURIComponent(input.datasetId)}/items`, {
    query: {
      limit: input.limit,
      offset: input.offset,
      clean: flag(input.clean),
      skipHidden: flag(input.skipHidden),
    },
  })
  // 这个端点不走 `{data}` 包裹,直接回裸数组。
  if (!Array.isArray(payload)) {
    throw new TBError('unavailable', 'Apify 的 dataset items 响应不是数组', { retryable: true })
  }
  return { items: payload }
}
