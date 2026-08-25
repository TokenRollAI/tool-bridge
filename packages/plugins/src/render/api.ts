/**
 * Render 的业务逻辑。
 *
 * 迁移自 open-connector `src/providers/render/executors.ts`,语义等价、写法本地化:
 * 凭证从 `ctx.upstreamAuth` 取,出站走 `guardedFetch`,错误抛 `TBError` 七码。
 *
 * Render 的三个特点决定了这里的形状:
 * - 列表接口返回的是 **`[{ service: {...}, cursor: 'x' }, ...]`** 这种"每项自带 cursor"
 *   的数组,不是 `{data, next}` 信封;`unwrapCursorList` 负责剥壳并取最后一项的 cursor。
 * - 多值过滤参数是 **逗号拼接**成一个 query 值,不是重复 key。
 * - `trigger_deploy` 在 202 时**没有响应体**,只能回一个 queued 确认。
 *
 * 与上游的一处口径差异:上游把 `404` 压成 400(`notFoundAsInvalidInput`),这里交给
 * 共用的 `upstreamError` 映射成 `not_found` —— 那个压平正是收口这层要消除的东西。
 */

import type { z } from 'zod/v4'
import { TBError } from '@tool-bridge/plugin-sdk'
import type {
  listDeploysInput,
  listServicesInput,
  listWorkspacesInput,
  resumeServiceInput,
  rollbackDeployInput,
  triggerDeployInput,
} from './schema'
import {
  createProviderHttpClient,
  type ProviderHttpErrorContext,
  type ProviderHttpRequest,
  type ProviderHttpResult,
} from '../_runtime/providerHttp'
import { type ProviderContext, requireApiKey } from '../_runtime/plugin'
import { trimmedText as nonEmpty } from '../_runtime/jsonValue'
import { upstreamError } from '../_runtime/upstreamError'

const SERVICE = 'render'
const API_BASE = 'https://api.render.com/v1'
const http = createProviderHttpClient({ baseUrl: `${API_BASE}/`, service: SERVICE })

type Json = Record<string, unknown>
type QueryValue = boolean | number | string | string[] | undefined

interface RequestInput {
  body?: Json
  method?: ProviderHttpRequest['method']
  path: string
  query?: Record<string, QueryValue>
}

/**
 * schema 里 serviceId / deployId 被生成成 optional(上游 action 定义如此),但接口
 * 没了它就拼不出路径,所以这层仍要挡:否则会打出 `/services/undefined`。
 */
function pathSegment(value: string | undefined, field: string): string {
  const parsed = nonEmpty(value)
  if (parsed === undefined) throw new TBError('invalid_argument', `${field} 不能为空`)
  return encodeURIComponent(parsed)
}

function firstString(...values: unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value === 'string' && value !== '') return value
  }
  return undefined
}

/** Render 的错误体有 `message|error|detail|title`,也有 `errors:[...]`(元素是串或对象)。 */
function errorMessage(context: ProviderHttpErrorContext): string {
  if (context.bodyKind === 'empty') return `Render 返回 HTTP ${context.status}`
  if (context.bodyKind !== 'json') return String(context.data)
  const payload = context.data
  if (payload !== null && typeof payload === 'object' && !Array.isArray(payload)) {
    const object = payload as Json
    const direct = firstString(object.message, object.error, object.detail, object.title)
    if (direct !== undefined) return direct
    const errors = object.errors
    if (Array.isArray(errors) && errors.length > 0) {
      const first = errors[0]
      if (typeof first === 'string' && first !== '') return first
      if (first !== null && typeof first === 'object' && !Array.isArray(first)) {
        const nested = firstString((first as Json).message, (first as Json).error, (first as Json).detail)
        if (nested !== undefined) return nested
      }
    }
  }
  return `Render 返回 HTTP ${context.status}`
}

async function send(ctx: ProviderContext, input: RequestInput): Promise<ProviderHttpResult> {
  const apiKey = requireApiKey(ctx, SERVICE)
  const query = Object.entries(input.query ?? {}).flatMap(([key, value]) => {
    // Render 的多值过滤是逗号拼接进一个 query 值,不是重复 key。
    if (Array.isArray(value)) return value.length === 0 ? [] : [[key, value.join(',')] as const]
    return [[key, value] as const]
  })
  return await http.request({
    method: input.method ?? 'GET',
    path: input.path,
    query,
    headers: {
      accept: 'application/json',
      authorization: `Bearer ${apiKey}`,
    },
    ...(input.body === undefined ? {} : { json: input.body }),
    invalidJson: 'text',
    mapError: context => upstreamError(context.status, errorMessage(context)),
    mapTransportError: ({ message }) => new TBError(
      'unavailable',
      message === undefined ? 'Render 请求失败' : `Render 请求失败: ${message}`,
      { retryable: true },
    ),
  })
}

async function requestJson<T>(ctx: ProviderContext, input: RequestInput): Promise<T> {
  const response = await send(ctx, input)
  if (response.bodyKind !== 'json') {
    throw new TBError('unavailable', 'Render 返回了非 JSON 响应', { retryable: true })
  }
  return response.data as T
}

/** 生命周期操作(restart/suspend/resume)只看状态码,响应体无意义。 */
async function requestAck(ctx: ProviderContext, input: RequestInput): Promise<void> {
  await send(ctx, input)
}

/**
 * Render 的列表形状:`[{ <key>: {...}, cursor: 'c1' }, ...]`。
 * cursor 挂在每一项上,取最后一个非空的当下一页游标(上游同此)。
 */
function unwrapCursorList(payload: unknown, key: string): { items: Json[], nextCursor: null | string } {
  if (!Array.isArray(payload)) {
    throw new TBError('unavailable', 'Render 列表响应不是数组', { retryable: true })
  }
  const items: Json[] = []
  let nextCursor: null | string = null
  for (const entry of payload) {
    if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) {
      throw new TBError('unavailable', 'Render 列表项不是对象', { retryable: true })
    }
    const record = entry as Json
    const value = record[key]
    if (value === null || typeof value !== 'object' || Array.isArray(value)) {
      throw new TBError('unavailable', `Render 响应缺少 ${key}`, { retryable: true })
    }
    items.push(value as Json)
    nextCursor = nonEmpty(typeof record.cursor === 'string' ? record.cursor : undefined) ?? nextCursor
  }
  return { items, nextCursor }
}

export async function getCurrentUser(_input: unknown, ctx: ProviderContext): Promise<unknown> {
  return await requestJson(ctx, { path: '/users' })
}

export async function listWorkspaces(
  input: z.infer<typeof listWorkspacesInput>,
  ctx: ProviderContext,
): Promise<Json> {
  const payload = await requestJson<unknown>(ctx, {
    path: '/owners',
    query: {
      name: input.name,
      email: input.email,
      cursor: nonEmpty(input.cursor),
      limit: input.limit,
    },
  })
  const { items, nextCursor } = unwrapCursorList(payload, 'owner')
  return { workspaces: items, nextCursor }
}

export async function listServices(
  input: z.infer<typeof listServicesInput>,
  ctx: ProviderContext,
): Promise<Json> {
  const payload = await requestJson<unknown>(ctx, {
    path: '/services',
    query: {
      name: input.name,
      type: input.type,
      ownerId: input.ownerId,
      suspended: input.suspended,
      includePreviews: input.includePreviews,
      cursor: nonEmpty(input.cursor),
      limit: input.limit,
    },
  })
  const { items, nextCursor } = unwrapCursorList(payload, 'service')
  return { services: items, nextCursor }
}

export async function getService(
  input: { serviceId?: string },
  ctx: ProviderContext,
): Promise<unknown> {
  return await requestJson(ctx, { path: `/services/${pathSegment(input.serviceId, 'serviceId')}` })
}

export async function listDeploys(
  input: z.infer<typeof listDeploysInput>,
  ctx: ProviderContext,
): Promise<Json> {
  const payload = await requestJson<unknown>(ctx, {
    path: `/services/${pathSegment(input.serviceId, 'serviceId')}/deploys`,
    query: {
      status: input.status,
      cursor: nonEmpty(input.cursor),
      limit: input.limit,
    },
  })
  const { items, nextCursor } = unwrapCursorList(payload, 'deploy')
  return { deploys: items, nextCursor }
}

export async function triggerDeploy(
  input: z.infer<typeof triggerDeployInput>,
  ctx: ProviderContext,
): Promise<unknown> {
  const serviceId = pathSegment(input.serviceId, 'serviceId')
  // Render 的 deployMode 与手动指定 commit/image/cache 是两条互斥路径,服务端报错含糊。
  if (
    input.deployMode !== undefined
    && (input.commitId !== undefined || input.imageUrl !== undefined || input.clearCache !== undefined)
  ) {
    throw new TBError('invalid_argument', 'deployMode 不能与 commitId、imageUrl、clearCache 同时给')
  }
  const response = await send(ctx, {
    path: `/services/${serviceId}/deploys`,
    method: 'POST',
    // clearCache 没给时上游也显式发 do_not_clear(而不是省略),保持等价。
    body: {
      clearCache: input.clearCache === true ? 'clear' : 'do_not_clear',
      ...(nonEmpty(input.commitId) === undefined ? {} : { commitId: nonEmpty(input.commitId) }),
      ...(nonEmpty(input.imageUrl) === undefined ? {} : { imageUrl: nonEmpty(input.imageUrl) }),
      ...(input.deployMode === undefined ? {} : { deployMode: input.deployMode }),
    },
  })
  // 202 表示已排队但还没有 deploy 对象可返回。
  if (response.status === 202) return { queued: true, serviceId: input.serviceId }
  if (response.bodyKind !== 'json') {
    throw new TBError('unavailable', 'Render 返回了非 JSON 响应', { retryable: true })
  }
  return response.data as Json
}

export async function rollbackDeploy(
  input: z.infer<typeof rollbackDeployInput>,
  ctx: ProviderContext,
): Promise<unknown> {
  const serviceId = pathSegment(input.serviceId, 'serviceId')
  const deployId = nonEmpty(input.deployId)
  if (deployId === undefined) throw new TBError('invalid_argument', 'deployId 不能为空')
  return await requestJson(ctx, {
    path: `/services/${serviceId}/rollback`,
    method: 'POST',
    body: { deployId },
  })
}

export async function restartService(
  input: z.infer<typeof resumeServiceInput>,
  ctx: ProviderContext,
): Promise<Json> {
  await requestAck(ctx, {
    path: `/services/${pathSegment(input.serviceId, 'serviceId')}/restart`,
    method: 'POST',
  })
  return { ok: true, serviceId: input.serviceId, action: 'restart' }
}

export async function suspendService(
  input: z.infer<typeof resumeServiceInput>,
  ctx: ProviderContext,
): Promise<Json> {
  await requestAck(ctx, {
    path: `/services/${pathSegment(input.serviceId, 'serviceId')}/suspend`,
    method: 'POST',
  })
  return { ok: true, serviceId: input.serviceId, action: 'suspend' }
}

export async function resumeService(
  input: z.infer<typeof resumeServiceInput>,
  ctx: ProviderContext,
): Promise<Json> {
  await requestAck(ctx, {
    path: `/services/${pathSegment(input.serviceId, 'serviceId')}/resume`,
    method: 'POST',
  })
  return { ok: true, serviceId: input.serviceId, action: 'resume' }
}
