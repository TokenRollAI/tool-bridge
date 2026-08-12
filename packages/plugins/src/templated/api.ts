/**
 * Templated 的业务逻辑。
 *
 * 迁移自 open-connector `src/providers/templated/executors.ts`,语义等价、写法本地化:
 * 凭证从 `ctx.upstreamAuth` 取,出站走 `guardedFetch`,错误抛 `TBError` 七码。
 *
 * 与上游的一处有意偏离:上游 `createTemplatedError` 在 get/delete 单实体时把 404 压成
 * 400(`notFoundAsInvalidInput`)。这里把原始状态交给 `upstreamError`,404 仍是
 * not_found —— 收敛各 provider 互不相同的错误口径正是 `_runtime/upstreamError.ts` 的理由。
 */

import type { z } from 'zod/v4'
import { TBError } from '@tool-bridge/plugin-sdk'
import type {
  createRenderInput,
  deleteRenderInput,
  getRenderInput,
  getTemplateInput,
  listTemplatesInput,
} from './schema'
import { type ProviderContext, requireApiKey } from '../_runtime/plugin'
import { upstreamError } from '../_runtime/upstreamError'
import { guardedFetch } from '../_runtime/guardedFetch'

const SERVICE = 'templated'
const API_BASE = 'https://api.templated.io/v1'

type Json = Record<string, unknown>

/** 上游 `optionalString`:非字符串、或去空白后为空,都算缺失。 */
function text(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  return trimmed === '' ? undefined : trimmed
}

function record(value: unknown): Json | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Json) : undefined
}

/** 上游 `nullableStringValue`:显式 null 保留,其余走 `optionalString`。 */
function nullableText(value: unknown): string | null | undefined {
  return value === null ? null : text(value)
}

/** 上游 `readNullableInteger`:显式 null 保留,非整数一律当缺失。 */
function nullableInteger(value: unknown): number | null | undefined {
  if (value === undefined) return undefined
  if (value === null) return null
  return typeof value === 'number' && Number.isInteger(value) ? value : undefined
}

/** 上游 `compactObject`:剥掉值为 undefined 的键(响应形状里"缺失"与"null"含义不同)。 */
function compact(input: Json): Json {
  return Object.fromEntries(Object.entries(input).filter(([, value]) => value !== undefined))
}

function errorMessage(payload: unknown): string | undefined {
  if (typeof payload === 'string' && payload.trim() !== '') return payload
  const body = record(payload)
  if (body === undefined) return undefined
  return text(body.message) ?? text(body.error) ?? text(body.detail)
}

/** 204 与空体都回 null;JSON 解析不了就把原文当 payload,留给消息提取。 */
async function readPayload(response: Response): Promise<unknown> {
  if (response.status === 204) return null
  const body = await response.text().catch(() => '')
  if (body === '') return null
  try {
    return JSON.parse(body) as unknown
  } catch {
    return body
  }
}

interface RequestInput {
  body?: Json
  method?: 'DELETE' | 'GET' | 'POST'
  query?: Record<string, boolean | number | string | undefined>
}

async function request(ctx: ProviderContext, path: string, input: RequestInput = {}): Promise<unknown> {
  // 取凭证放在 try 外:它抛的是配置错误,不该被下面的传输失败兜底吞成 502。
  const apiKey = requireApiKey(ctx, SERVICE)

  // base 末尾补 `/`、path 去掉首 `/`:否则 URL 相对解析会吃掉 `/v1` 这一段。
  const url = new URL(path.startsWith('/') ? path.slice(1) : path, `${API_BASE}/`)
  for (const [key, value] of Object.entries(input.query ?? {})) {
    if (value !== undefined) url.searchParams.set(key, String(value))
  }

  const headers: Record<string, string> = {
    accept: 'application/json',
    authorization: `Bearer ${apiKey}`,
  }
  if (input.body !== undefined) headers['content-type'] = 'application/json'

  let response: Response
  try {
    response = await guardedFetch(url.toString(), {
      method: input.method ?? 'GET',
      headers,
      ...(input.body === undefined ? {} : { body: JSON.stringify(input.body) }),
    })
  } catch (error) {
    // 传输层失败必须就地归一:漏出去的裸 Error 会被 plugin-sdk 抹成 500。
    throw upstreamError(502, error instanceof Error ? `templated 请求失败: ${error.message}` : 'templated 请求失败')
  }

  const payload = await readPayload(response)
  if (!response.ok) {
    throw upstreamError(response.status, errorMessage(payload) ?? (response.statusText || 'templated 请求失败'))
  }
  return payload
}

function requireRecord(payload: unknown, entity: string): Json {
  const object = record(payload)
  if (object === undefined) {
    throw new TBError('unavailable', `templated 返回的 ${entity} 不是对象`, { retryable: true })
  }
  return object
}

/** 响应里缺了这个字段说明上游违约,不是调用方的错。 */
function requireResponseText(value: unknown, field: string): string {
  const result = text(value)
  if (result === undefined) {
    throw new TBError('unavailable', `templated 响应缺少 ${field}`, { retryable: true })
  }
  return result
}

/**
 * 列表端点的响应有三种形状:裸数组、`{data:[...]}`、`{templates|renders:[...]}`。
 * 上游三种都收,迁移时照搬 —— Templated 各端点之间并不一致。
 */
function readCollection(payload: unknown, entity: string): Json[] {
  if (Array.isArray(payload)) return payload.map(item => requireRecord(item, entity))
  const object = requireRecord(payload, entity)
  if (Array.isArray(object.data)) return object.data.map(item => requireRecord(item, entity))
  const plural = object[`${entity}s`]
  if (Array.isArray(plural)) return plural.map(item => requireRecord(item, entity))
  throw new TBError('unavailable', `templated 返回了非预期的 ${entity}s 载荷`, { retryable: true })
}

/** create_render 与列表不同:非数组、也没有 `data` 时,整个对象就是那一条 render。 */
function readRenderCreatePayload(payload: unknown): Json[] {
  if (Array.isArray(payload)) return payload.map(item => requireRecord(item, 'render'))
  const object = requireRecord(payload, 'render')
  if (Array.isArray(object.data)) return object.data.map(item => requireRecord(item, 'render'))
  return [object]
}

function normalizeAccount(payload: unknown): Json {
  const object = requireRecord(payload, 'account')
  // 账号字段在两代响应里分别挂在顶层和 `user` 下,两处都要看。
  const user = record(object.user)
  return compact({
    id: text(object.id) ?? text(user?.id),
    name: text(object.name) ?? text(user?.name),
    email: text(object.email) ?? text(user?.email),
    plan: nullableText(object.plan),
    watermark: typeof object.watermark === 'boolean' ? object.watermark : undefined,
    createdAt: nullableText(object.createdAt),
  })
}

function normalizeOptionalUser(value: unknown): Json | undefined {
  const user = record(value)
  if (user === undefined) return undefined
  return compact({ id: text(user.id), name: text(user.name) })
}

function normalizeTemplate(payload: unknown): Json {
  const object = requireRecord(payload, 'template')
  return compact({
    id: requireResponseText(object.id, 'template.id'),
    name: requireResponseText(object.name, 'template.name'),
    description: nullableText(object.description),
    width: nullableInteger(object.width),
    height: nullableInteger(object.height),
    thumbnail: nullableText(object.thumbnail),
    background: nullableText(object.background),
    layersCount: nullableInteger(object.layersCount),
    folderId: nullableText(object.folderId),
    externalId: nullableText(object.externalId),
    user: normalizeOptionalUser(object.user),
    layers: Array.isArray(object.layers) ? object.layers : undefined,
    pages: Array.isArray(object.pages) ? object.pages : undefined,
    tags: Array.isArray(object.tags) ? object.tags.filter(item => typeof item === 'string') : undefined,
  })
}

function normalizeRender(payload: unknown): Json {
  const object = requireRecord(payload, 'render')
  return compact({
    id: requireResponseText(object.id, 'render.id'),
    url: nullableText(object.url),
    width: nullableInteger(object.width),
    height: nullableInteger(object.height),
    name: nullableText(object.name),
    status: nullableText(object.status),
    format: nullableText(object.format),
    templateId: nullableText(object.templateId),
    templateName: nullableText(object.templateName),
    createdAt: nullableText(object.createdAt),
    externalId: nullableText(object.externalId),
  })
}

export async function getAccount(_input: unknown, ctx: ProviderContext): Promise<Json> {
  return { account: normalizeAccount(await request(ctx, '/account')) }
}

export async function listTemplates(
  input: z.infer<typeof listTemplatesInput>,
  ctx: ProviderContext,
): Promise<Json> {
  const payload = await request(ctx, '/templates', {
    query: {
      query: input.query,
      page: input.page,
      limit: input.limit,
      width: input.width,
      height: input.height,
      // 官方 tags 过滤器收的是逗号串,不是重复键。
      tags: input.tags?.join(','),
      externalId: input.externalId,
      includeLayers: input.includeLayers,
      includePages: input.includePages,
    },
  })
  return { templates: readCollection(payload, 'template').map(normalizeTemplate) }
}

export async function getTemplate(
  input: z.infer<typeof getTemplateInput>,
  ctx: ProviderContext,
): Promise<Json> {
  const payload = await request(ctx, `/template/${encodeURIComponent(input.templateId)}`, {
    query: { includeLayers: input.includeLayers, includePages: input.includePages },
  })
  return { template: normalizeTemplate(payload) }
}

export async function createRender(
  input: z.infer<typeof createRenderInput>,
  ctx: ProviderContext,
): Promise<Json> {
  const payload = await request(ctx, '/render', {
    method: 'POST',
    // 请求体的键名与入参不同名(templateId → template、externalId → external_id 等),
    // 这是 Templated 自己的字段命名,不能直接透传 input。
    body: compact({
      template: input.templateId,
      format: input.format,
      transparent: input.transparent,
      flatten: input.flatten,
      cmyk: input.cmyk,
      name: input.name,
      background: input.background,
      width: input.width,
      height: input.height,
      scale: input.scale,
      external_id: input.externalId,
      async: input.async,
      webhook_url: input.webhookUrl,
      layers: input.layers,
    }),
  })
  return { renders: readRenderCreatePayload(payload).map(normalizeRender) }
}

export async function listRenders(_input: unknown, ctx: ProviderContext): Promise<Json> {
  return { renders: readCollection(await request(ctx, '/renders'), 'render').map(normalizeRender) }
}

export async function getRender(
  input: z.infer<typeof getRenderInput>,
  ctx: ProviderContext,
): Promise<Json> {
  const payload = await request(ctx, `/render/${encodeURIComponent(input.renderId)}`)
  return { render: normalizeRender(payload) }
}

export async function deleteRender(
  input: z.infer<typeof deleteRenderInput>,
  ctx: ProviderContext,
): Promise<Json> {
  await request(ctx, `/render/${encodeURIComponent(input.renderId)}`, { method: 'DELETE' })
  return { deleted: true, renderId: input.renderId }
}
