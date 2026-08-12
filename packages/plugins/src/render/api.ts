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
import { type ProviderContext, requireApiKey } from '../_runtime/plugin'
import { upstreamError } from '../_runtime/upstreamError'
import { guardedFetch } from '../_runtime/guardedFetch'

const SERVICE = 'render'
const API_BASE = 'https://api.render.com/v1'

type Json = Record<string, unknown>
type QueryValue = boolean | number | string | string[] | undefined

interface RequestInput {
  body?: Json
  method?: string
  path: string
  query?: Record<string, QueryValue>
}

/** 上游 `optionalString`:trim 后为空视同没给。 */
function nonEmpty(value: string | undefined): string | undefined {
  const trimmed = value?.trim()
  return trimmed === undefined || trimmed === '' ? undefined : trimmed
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
async function errorMessage(response: Response): Promise<string> {
  let payload: unknown
  try {
    payload = await response.clone().json()
  } catch {
    const text = await response.text().catch(() => '')
    return text === '' ? `Render 返回 HTTP ${response.status}` : text
  }
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
  return `Render 返回 HTTP ${response.status}`
}

async function send(ctx: ProviderContext, input: RequestInput): Promise<Response> {
  const apiKey = requireApiKey(ctx, SERVICE)
  const url = new URL(`${API_BASE}${input.path}`)
  for (const [key, value] of Object.entries(input.query ?? {})) {
    if (value === undefined) continue
    if (Array.isArray(value)) {
      // Render 的多值过滤是逗号拼接进一个 query 值,不是重复 key。
      if (value.length > 0) url.searchParams.set(key, value.join(','))
      continue
    }
    url.searchParams.set(key, String(value))
  }

  const headers: Record<string, string> = {
    accept: 'application/json',
    authorization: `Bearer ${apiKey}`,
  }
  if (input.body !== undefined) headers['content-type'] = 'application/json'

  try {
    return await guardedFetch(url.toString(), {
      method: input.method ?? 'GET',
      headers,
      body: input.body === undefined ? undefined : JSON.stringify(input.body),
    })
  } catch (error) {
    if (error instanceof TBError) throw error
    throw new TBError(
      'unavailable',
      error instanceof Error ? `Render 请求失败: ${error.message}` : 'Render 请求失败',
      { retryable: true },
    )
  }
}

async function requestJson<T>(ctx: ProviderContext, input: RequestInput): Promise<T> {
  const response = await send(ctx, input)
  if (!response.ok) throw upstreamError(response.status, await errorMessage(response))
  try {
    return (await response.json()) as T
  } catch {
    throw new TBError('unavailable', 'Render 返回了非 JSON 响应', { retryable: true })
  }
}

/** 生命周期操作(restart/suspend/resume)只看状态码,响应体无意义。 */
async function requestAck(ctx: ProviderContext, input: RequestInput): Promise<void> {
  const response = await send(ctx, input)
  if (!response.ok) throw upstreamError(response.status, await errorMessage(response))
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
  if (!response.ok) throw upstreamError(response.status, await errorMessage(response))
  // 202 表示已排队但还没有 deploy 对象可返回。
  if (response.status === 202) return { queued: true, serviceId: input.serviceId }
  try {
    return (await response.json()) as Json
  } catch {
    throw new TBError('unavailable', 'Render 返回了非 JSON 响应', { retryable: true })
  }
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
