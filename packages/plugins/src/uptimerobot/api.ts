/**
 * UptimeRobot 的业务逻辑。
 *
 * 迁移自 open-connector `src/providers/uptimerobot/executors.ts`,语义等价、写法本地化:
 * 凭证从 `ctx.upstreamAuth` 取,出站走 `guardedFetch`,错误抛 `TBError` 七码。
 *
 * UptimeRobot v2 是"POST form-urlencoded 到固定端点、成功也回 HTTP 200"的老式 API:
 * 凭证与 `format=json` 都走 body,失败通过 body 里的 `stat !== 'ok'` 表达而非 HTTP 状态。
 * 因此下面的错误归一必须同时看 HTTP 状态与 `error.type`,不能只看状态码。
 */

import type { z } from 'zod/v4'
import { TBError } from '@tool-bridge/plugin-sdk'
import type {
  createMonitorInput,
  deleteMonitorInput,
  getMonitorInput,
  listMonitorsInput,
  updateMonitorInput,
} from './schema'
import { type ProviderContext, requireApiKey } from '../_runtime/plugin'
import { asJsonObject as record } from '../_runtime/jsonValue'
import { upstreamError } from '../_runtime/upstreamError'
import { guardedFetch } from '../_runtime/guardedFetch'

const SERVICE = 'uptimerobot'
const API_BASE = 'https://api.uptimerobot.com/v2/'

type Json = Record<string, unknown>

/** 上游 `optionalString`:非字符串或空串都算缺失。 */
function text(value: unknown): string | undefined {
  return typeof value === 'string' && value !== '' ? value : undefined
}

/** UptimeRobot 的数值字段时而是 int 时而是字符串,统一按整数读。 */
function integer(value: unknown): number | undefined {
  if (Number.isInteger(value)) return value as number
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value)
    return Number.isInteger(parsed) ? parsed : undefined
  }
  return undefined
}

/**
 * 把一次失败归一成 TBError。上游 `createUptimerobotError` 的映射照搬,只做一处收敛:
 * 上游把 5xx 统一改写成 502 再交给自己的映射表,这里直接把原状态交给 `upstreamError`
 * (5xx 一律 unavailable+retryable),语义相同而少一次状态改写。
 */
function toError(status: number, payload: unknown): TBError {
  const error = record(record(payload)?.error)
  const message = text(error?.message)
    ?? (!status || status === 200
      ? 'uptimerobot request failed'
      : `uptimerobot request failed with status ${status}`)
  const type = text(error?.type)
  // stat!=='ok' 时 HTTP 状态往往是 200,此时只有 error.type 能区分是限流、凭证还是参数问题。
  const httpStatus = status >= 400 ? status : undefined

  if (httpStatus === 429 || type?.includes('rate_limit') === true) return upstreamError(429, message)
  if (httpStatus === 401 || httpStatus === 403 || type === 'invalid_api_key') {
    return upstreamError(httpStatus === 403 ? 403 : 401, message)
  }
  if (httpStatus !== undefined && [400, 404, 422].includes(httpStatus)) return upstreamError(httpStatus, message)
  if (type === 'invalid_parameter') return upstreamError(400, message)
  return upstreamError(httpStatus ?? 502, message)
}

async function readPayload(response: Response): Promise<unknown> {
  const body = await response.text().catch(() => '')
  if (body === '') return undefined
  try {
    return JSON.parse(body) as unknown
  } catch {
    throw upstreamError(502, 'uptimerobot returned invalid JSON')
  }
}

async function request(ctx: ProviderContext, endpoint: string, body?: URLSearchParams): Promise<Json> {
  // 取凭证放在 try 外:它抛的是配置错误,不该被下面的传输失败兜底吞成 502。
  const apiKey = requireApiKey(ctx, SERVICE)

  const form = new URLSearchParams(body)
  form.set('api_key', apiKey)
  form.set('format', 'json')

  let response: Response
  try {
    response = await guardedFetch(new URL(endpoint, API_BASE).toString(), {
      method: 'POST',
      headers: {
        'accept': 'application/json',
        'content-type': 'application/x-www-form-urlencoded',
      },
      body: form,
    })
  } catch (error) {
    // 传输层失败必须就地归一:漏出去的裸 Error 会被 plugin-sdk 抹成 "internal plugin error" 500。
    throw upstreamError(
      502,
      error instanceof Error ? `uptimerobot request failed: ${error.message}` : 'uptimerobot request failed',
    )
  }

  const payload = await readPayload(response)
  if (!response.ok) throw toError(response.status, payload)
  const parsed = record(payload)
  if (parsed === undefined) throw upstreamError(502, 'uptimerobot returned an invalid response payload')
  if (parsed.stat !== 'ok') throw toError(response.status, parsed)
  return parsed
}

function requireObjectPayload(value: unknown, label: string): Json {
  const parsed = record(value)
  // 上游破了契约,不是调用方的错。
  if (parsed === undefined) throw upstreamError(502, `${label} must be an object`)
  return parsed
}

function requireArrayPayload(value: unknown, label: string): unknown[] {
  if (!Array.isArray(value)) throw upstreamError(502, `${label} must be an array`)
  return value
}

/** 三个分页字段一个都读不出时回 null(而不是空对象),与上游一致。 */
function readPagination(payload: Json): Json | null {
  const limit = integer(payload.limit)
  const offset = integer(payload.offset)
  const total = integer(payload.total)
  if (limit === undefined && offset === undefined && total === undefined) return null
  const pagination: Json = {}
  if (limit !== undefined) pagination.limit = limit
  if (offset !== undefined) pagination.offset = offset
  if (total !== undefined) pagination.total = total
  return pagination
}

function setBoolean(form: URLSearchParams, key: string, value: boolean | undefined): void {
  if (typeof value === 'boolean') form.set(key, value ? '1' : '0')
}

function setNumber(form: URLSearchParams, key: string, value: number | undefined): void {
  if (value !== undefined) form.set(key, String(value))
}

function setText(form: URLSearchParams, key: string, value: string | undefined): void {
  if (value !== undefined && value !== '') form.set(key, value)
}

/** UptimeRobot 的多值过滤器用连字符拼接,不是重复同名键也不是逗号。 */
function setHyphenJoined(form: URLSearchParams, key: string, value: number[] | undefined): void {
  if (value !== undefined) form.set(key, value.join('-'))
}

/**
 * alert_contacts 的官方线格式是 `id_threshold_recurrence` 用连字符连接。
 * schema 允许结构化条目里 `id` 缺省,但线格式没有"省略 id"的表达,故在此挡下。
 */
function encodeAlertContacts(
  value: NonNullable<z.infer<typeof createMonitorInput>['alert_contacts']>,
): string {
  if (typeof value === 'string') return value
  return value
    .map((item) => {
      if (typeof item === 'number') return `${item}_0_0`
      if (item.id === undefined) throw new TBError('invalid_argument', 'alert_contacts.id must be a positive integer')
      return `${item.id}_${item.threshold ?? 0}_${item.recurrence ?? 0}`
    })
    .join('-')
}

/** create/update 共用的 body;字段顺序照抄上游,让请求可预期。 */
function buildMonitorMutationBody(
  input: z.infer<typeof createMonitorInput> | z.infer<typeof updateMonitorInput>,
): URLSearchParams {
  const form = new URLSearchParams()
  setText(form, 'friendly_name', input.friendly_name)
  setText(form, 'url', input.url)
  setNumber(form, 'type', input.type)
  setNumber(form, 'sub_type', input.sub_type)
  setNumber(form, 'port', input.port)
  setNumber(form, 'interval', input.interval)
  setNumber(form, 'timeout', input.timeout)
  setNumber(form, 'keyword_type', input.keyword_type)
  setText(form, 'keyword_value', input.keyword_value)
  setText(form, 'http_username', input.http_username)
  setText(form, 'http_password', input.http_password)
  setBoolean(form, 'ssl', input.ssl)
  if (input.alert_contacts !== undefined) form.set('alert_contacts', encodeAlertContacts(input.alert_contacts))
  return form
}

export async function getAccountDetails(_input: unknown, ctx: ProviderContext): Promise<Json> {
  const payload = await request(ctx, 'getAccountDetails')
  return { account: requireObjectPayload(payload.account, 'uptimerobot account details response') }
}

export async function listAlertContacts(_input: unknown, ctx: ProviderContext): Promise<Json> {
  const payload = await request(ctx, 'getAlertContacts')
  return {
    alert_contacts: requireArrayPayload(payload.alert_contacts, 'uptimerobot alert contacts response'),
    pagination: readPagination(payload),
  }
}

export async function listMonitors(
  input: z.infer<typeof listMonitorsInput>,
  ctx: ProviderContext,
): Promise<Json> {
  const form = new URLSearchParams()
  setNumber(form, 'offset', input.offset)
  setNumber(form, 'limit', input.limit)
  setText(form, 'search', input.search)
  setText(form, 'sort', input.sort)
  setHyphenJoined(form, 'monitors', input.monitor_ids)
  setHyphenJoined(form, 'types', input.types)
  setHyphenJoined(form, 'statuses', input.statuses)
  setBoolean(form, 'logs', input.logs)
  setBoolean(form, 'alert_contacts', input.alert_contacts)

  const payload = await request(ctx, 'getMonitors', form)
  return {
    monitors: requireArrayPayload(payload.monitors, 'uptimerobot monitors response'),
    pagination: readPagination(payload),
  }
}

/** 单个监控没有专门端点:仍打 getMonitors,用 `monitors` 过滤器取一条。 */
export async function getMonitor(
  input: z.infer<typeof getMonitorInput>,
  ctx: ProviderContext,
): Promise<Json> {
  const form = new URLSearchParams()
  form.set('monitors', String(input.monitor_id))
  setBoolean(form, 'logs', input.logs)
  setBoolean(form, 'alert_contacts', input.alert_contacts)

  const payload = await request(ctx, 'getMonitors', form)
  const monitors = requireArrayPayload(payload.monitors, 'uptimerobot single monitor response')
  const monitor = record(monitors[0])
  // 过滤器匹配不到时 UptimeRobot 回的是 stat:'ok' + 空数组,得自己变成 404。
  if (monitor === undefined) throw upstreamError(404, `monitor ${input.monitor_id} was not found`)
  return { monitor }
}

export async function createMonitor(
  input: z.infer<typeof createMonitorInput>,
  ctx: ProviderContext,
): Promise<Json> {
  const payload = await request(ctx, 'newMonitor', buildMonitorMutationBody(input))
  return { monitor: requireObjectPayload(payload.monitor, 'uptimerobot create monitor response') }
}

export async function updateMonitor(
  input: z.infer<typeof updateMonitorInput>,
  ctx: ProviderContext,
): Promise<Json> {
  const form = buildMonitorMutationBody(input)
  form.set('id', String(input.monitor_id))
  const payload = await request(ctx, 'editMonitor', form)
  return { monitor: requireObjectPayload(payload.monitor, 'uptimerobot update monitor response') }
}

export async function deleteMonitor(
  input: z.infer<typeof deleteMonitorInput>,
  ctx: ProviderContext,
): Promise<Json> {
  // schema 把 monitor_id 标成了可选(上游 action 定义如此),但上游 executor 无条件要求它。
  // 以上游行为为准在本地挡下,而不是发一个必定失败的删除请求。
  if (input.monitor_id === undefined) {
    throw new TBError('invalid_argument', 'monitor_id must be a positive integer')
  }
  const form = new URLSearchParams()
  form.set('id', String(input.monitor_id))
  const payload = await request(ctx, 'deleteMonitor', form)
  requireObjectPayload(payload.monitor, 'uptimerobot delete monitor response')
  return { deleted: true }
}
