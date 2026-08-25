/**
 * Replicate 的业务逻辑。
 *
 * 迁移自 open-connector `src/providers/replicate/runtime.ts`,语义等价、写法本地化:
 * 凭证从 `ctx.upstreamAuth` 取(平台经 authRef 注入),出站走 `guardedFetch`,错误抛
 * `TBError` 七码。凭证在 **header**(`Authorization: Bearer r8_...`),不在 URL 上。
 *
 * 四处上游细节决定了这里的形状:
 * - **schema 说可选、executor 却必填**:`owner`/`model`/`versionId`/`collectionSlug`/
 *   `predictionId` 在生成的 schema 里全是 `.optional()`(上游 action 声明没写 required),
 *   但它们要拼进 URL 路径 —— 缺了就会打到 `/v1/models/undefined` 这种地址上。上游用
 *   `requiredString` 拦下,这层保留该断言并归 `invalid_argument`(见 `segment`)。
 * - 路径段先**去空白**再 `encodeURIComponent`:`requiredString` 的语义是"trim 后仍非空",
 *   所以 `owner: ' foo '` 打出去的是 `foo` 而不是 `%20foo%20`。
 * - `create_prediction` 的两个参数走**请求头**而不是 body:`waitSeconds` → `Prefer: wait=N`
 *   (同步等待输出),`cancelAfter` → `Cancel-After`。放进 body 会被上游静默忽略。
 * - 分页出参把上游的 `results` 改名成各自的领域名(`models`/`versions`/`predictions`…),
 *   并保留 `next`/`previous` 两个游标 URL(非字符串一律记 null)。
 *
 * 与上游的两处有意偏离,理由写在各自注释里:错误码归一走共用表(上游把 403 压成 401、
 * 404 压成 400)、2xx 非 JSON 的处理。
 */

import type { z } from 'zod/v4'
import { TBError } from '@tool-bridge/plugin-sdk'
import type {
  cancelPredictionInput,
  createPredictionInput,
  getAccountInput,
  getCollectionInput,
  getModelInput,
  getModelVersionInput,
  getPredictionInput,
  listCollectionsInput,
  listModelsInput,
  listModelVersionsInput,
  listPredictionsInput,
} from './schema'
import { compactDefined as compact, asJsonObject as record, trimmedText as text } from '../_runtime/jsonValue'
import { type ProviderContext, requireApiKey } from '../_runtime/plugin'
import { createProviderHttpClient } from '../_runtime/providerHttp'
import { upstreamError } from '../_runtime/upstreamError'

const SERVICE = 'replicate'
const API_BASE = 'https://api.replicate.com'
/** 上游 credentialValidators 打的也是这个端点。 */
const ACCOUNT_PATH = '/v1/account'
const http = createProviderHttpClient({ baseUrl: `${API_BASE}/`, service: SERVICE })

type Json = Record<string, unknown>

interface RequestInput {
  body?: Json
  headers?: Record<string, string>
  method?: 'GET' | 'POST'
  path: string
  query?: Record<string, string | undefined>
}

/** 上游 `requiredString` 的等价物:去空白后仍非空,否则报 `invalid_argument`。 */
function required(value: string | undefined, field: string): string {
  const trimmed = text(value)
  if (trimmed === undefined) throw new TBError('invalid_argument', `${field} 不能为空`)
  return trimmed
}

/**
 * 一个 URL 路径段。上游 `encodePathSegment` = `encodeURIComponent(requiredString(...))`。
 *
 * schema 把这些字段声明成可选(上游 action 定义没写 required),但少了它们就没有可打的
 * 地址,故在这里必填断言 —— **不**改 schema 补 required(那份是生成物,要与上游对齐)。
 * 与上游唯一的差别是报错消息带上真实字段名(上游一律报 "path segment is required")。
 */
function segment(value: string | undefined, field: string): string {
  return encodeURIComponent(required(value, field))
}

/**
 * 发一次请求。
 *
 * **有意偏离上游**两处:
 * - 错误码走本仓库共用的 `upstreamError`,不用上游的 `mapReplicateError` —— 后者把 403
 *   压成 401、把 404 及其余 4xx 一并压成 400、5xx 一律记 502。压完之后"token 无权"与
 *   "token 无效"、"模型不存在"与"参数写错"在调用方眼里没有区别。共用表让这些语义在
 *   1300 个 provider 之间一致(403 → permission_denied,404 → not_found)。
 * - 2xx 上回非 JSON 时归 `unavailable` + retryable。上游的兜底会把 `{ detail: '<html>…' }`
 *   当正常载荷透出去,于是"上游坏了"呈现为一条字段名都对不上的成功响应。
 *   错误响应上回纯文本仍照上游用法,当成错误消息(见下面的 detail)。
 */
async function request(ctx: ProviderContext, input: RequestInput): Promise<unknown> {
  const headers: Record<string, string> = {
    accept: 'application/json',
    authorization: `Bearer ${requireApiKey(ctx, SERVICE)}`,
    ...input.headers,
  }
  const response = await http.request({
    method: input.method ?? 'GET',
    path: input.path,
    // 上游这里连空串一起跳过(空的 created_after 打出去会被上游当成非法时间戳)。
    query: Object.entries(input.query ?? {}).filter(([, value]) => value !== undefined && value !== ''),
    headers,
    ...(input.body === undefined ? {} : { json: input.body }),
    invalidJson: 'text',
    mapError: ({ bodyKind, data, status }) => {
      const body = bodyKind === 'json' ? record(data) ?? {} : { detail: data }
      return upstreamError(status, text(body.detail) ?? text(body.title) ?? `Replicate 返回 HTTP ${status}`)
    },
  })
  // 空体记成 `{}`(上游语义:cancel 之类可能不回内容)。
  if (response.bodyKind === 'empty') return {}
  if (response.bodyKind !== 'json') {
    throw new TBError('unavailable', 'Replicate 返回了非 JSON 响应', { retryable: true })
  }
  return response.data
}

/** 契约说好是对象;不是就是上游出问题,不是调用方的错。 */
function requireRecord(value: unknown, label: string): Json {
  const payload = record(value)
  if (payload === undefined) {
    throw new TBError('unavailable', `Replicate 的 ${label} 响应不是对象`, { retryable: true })
  }
  return payload
}

/** 分页:上游统一的 `{results, next, previous}` → 按领域改名的 `{<field>, next, previous}`。 */
function pageOf(value: unknown, field: string): Json {
  const payload = requireRecord(value, field)
  if (!Array.isArray(payload.results)) {
    // 少了 results 说明上游改了形状或回了别的东西,不是调用方的错。
    throw new TBError('unavailable', `Replicate 的 ${field} 响应缺少 results 数组`, { retryable: true })
  }
  return {
    [field]: payload.results,
    next: typeof payload.next === 'string' ? payload.next : null,
    previous: typeof payload.previous === 'string' ? payload.previous : null,
  }
}

/** 单对象:上游把它包一层领域名再返回。 */
function wrap(value: unknown, field: string): Json {
  return { [field]: requireRecord(value, field) }
}

export async function getAccount(_input: z.infer<typeof getAccountInput>, ctx: ProviderContext): Promise<Json> {
  return wrap(await request(ctx, { path: ACCOUNT_PATH }), 'account')
}

export async function listModels(input: z.infer<typeof listModelsInput>, ctx: ProviderContext): Promise<Json> {
  const payload = await request(ctx, {
    path: '/v1/models',
    query: compact({
      sort_by: text(input.sortBy),
      sort_direction: text(input.sortDirection),
    }),
  })
  return pageOf(payload, 'models')
}

export async function getModel(input: z.infer<typeof getModelInput>, ctx: ProviderContext): Promise<Json> {
  const path = `/v1/models/${segment(input.owner, 'owner')}/${segment(input.model, 'model')}`
  return wrap(await request(ctx, { path }), 'model')
}

export async function listModelVersions(
  input: z.infer<typeof listModelVersionsInput>,
  ctx: ProviderContext,
): Promise<Json> {
  const path = `/v1/models/${segment(input.owner, 'owner')}/${segment(input.model, 'model')}/versions`
  return pageOf(await request(ctx, { path }), 'versions')
}

export async function getModelVersion(
  input: z.infer<typeof getModelVersionInput>,
  ctx: ProviderContext,
): Promise<Json> {
  const path = `/v1/models/${segment(input.owner, 'owner')}/${segment(input.model, 'model')}`
    + `/versions/${segment(input.versionId, 'versionId')}`
  return wrap(await request(ctx, { path }), 'version')
}

export async function listCollections(
  _input: z.infer<typeof listCollectionsInput>,
  ctx: ProviderContext,
): Promise<Json> {
  return pageOf(await request(ctx, { path: '/v1/collections' }), 'collections')
}

export async function getCollection(input: z.infer<typeof getCollectionInput>, ctx: ProviderContext): Promise<Json> {
  const path = `/v1/collections/${segment(input.collectionSlug, 'collectionSlug')}`
  return wrap(await request(ctx, { path }), 'collection')
}

export async function createPrediction(
  input: z.infer<typeof createPredictionInput>,
  ctx: ProviderContext,
): Promise<Json> {
  // 这两个是**请求头**参数:Prefer 让上游同步等到 N 秒,Cancel-After 给运行时上限。
  const headers = compact<string>({
    'Prefer': input.waitSeconds === undefined ? undefined : `wait=${input.waitSeconds}`,
    'Cancel-After': text(input.cancelAfter),
  })
  const payload = await request(ctx, {
    method: 'POST',
    path: '/v1/predictions',
    headers,
    body: compact<unknown>({
      version: required(input.version, 'version'),
      input: record(input.input) ?? {},
      webhook: text(input.webhook),
      webhook_events_filter: input.webhookEventsFilter,
    }),
  })
  return wrap(payload, 'prediction')
}

export async function getPrediction(input: z.infer<typeof getPredictionInput>, ctx: ProviderContext): Promise<Json> {
  const path = `/v1/predictions/${segment(input.predictionId, 'predictionId')}`
  return wrap(await request(ctx, { path }), 'prediction')
}

export async function listPredictions(
  input: z.infer<typeof listPredictionsInput>,
  ctx: ProviderContext,
): Promise<Json> {
  const payload = await request(ctx, {
    path: '/v1/predictions',
    query: compact({
      created_after: text(input.createdAfter),
      created_before: text(input.createdBefore),
      source: text(input.source),
    }),
  })
  return pageOf(payload, 'predictions')
}

export async function cancelPrediction(
  input: z.infer<typeof cancelPredictionInput>,
  ctx: ProviderContext,
): Promise<Json> {
  const payload = await request(ctx, {
    method: 'POST',
    path: `/v1/predictions/${segment(input.predictionId, 'predictionId')}/cancel`,
    // 上游发的是空 JSON 对象(不是无 body)—— 少了它 content-type 也不会带上。
    body: {},
  })
  return wrap(payload, 'prediction')
}
