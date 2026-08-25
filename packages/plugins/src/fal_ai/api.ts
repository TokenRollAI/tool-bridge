/**
 * fal.ai 的业务逻辑。
 *
 * 迁移自 open-connector `src/providers/fal_ai/executors.ts`,语义等价、写法本地化:
 * 凭证从 `ctx.upstreamAuth` 取(平台经 authRef 注入),出站走 `guardedFetch`,错误抛
 * `TBError` 七码。
 *
 * 五处上游细节决定了这里的形状:
 * - **两个 host**:`api.fal.ai` 是平台面(模型目录、定价、JWKS),`queue.fal.run` 是队列面
 *   (状态、结果、取消)。同一个 key 两边都用,但 base URL 不能混。
 * - 凭证走 `Authorization: Key <FAL_KEY>` —— **不是 `Bearer`**。FAL_KEY 本身长得像
 *   `key_id:key_secret`,但对插件而言是**单个不透明字符串**:上游 `definition.ts` 声明的是
 *   单值 `api_key`,故这里不拆多字段凭证,原样塞进 header。
 * - `expand` / `endpointId` 既收单串也收字符串数组,数组要展开成**重复的同名** query 参数。
 *   注意上游对这两个参数**不做**去空白(只有 `q`/`cursor`/`status`/`category` 走
 *   `optionalString`),这层照抄 —— 收紧它等于悄悄改变可发出的过滤条件。
 * - `queue_get_status_stream` 是 SSE。工具调用要的是一个终值而不是一条流,故上游把整个
 *   响应体读完再切事件、只回汇总;这里保留该取舍(见 `parseSseEvents`)。
 * - `logs` 取 0/1 而非布尔,且 `logs: 0` 是**要发出去**的显式值(上游只丢 undefined)。
 *
 * 与上游的两处有意偏离,都在下面各自的注释里写明理由:404 的归一、modelId 的路径编码。
 */

import type { z } from 'zod/v4'
import { TBError } from '@tool-bridge/plugin-sdk'
import type {
  cancelQueueRequestInput,
  estimatePricingInput,
  getJwksInput,
  getModelsInput,
  getPricingInput,
  getQueueRequestResultInput,
  queueGetStatusInput,
  queueGetStatusStreamInput,
} from './schema'
import { compactDefined as compact, asJsonObject as record, trimmedText as text } from '../_runtime/jsonValue'
import { createProviderHttpClient, type ProviderQuery } from '../_runtime/providerHttp'
import { type ProviderContext, requireApiKey } from '../_runtime/plugin'
import { upstreamError } from '../_runtime/upstreamError'
import { guardedFetch } from '../_runtime/guardedFetch'

const SERVICE = 'fal_ai'
/** 平台面:模型目录、定价、JWKS。 */
const PLATFORM_BASE = 'https://api.fal.ai'
/** 队列面:排队请求的状态/结果/取消。 */
const QUEUE_BASE = 'https://queue.fal.run'
const http = createProviderHttpClient({ service: SERVICE })

type Json = Record<string, unknown>
type QueryValue = number | string | string[] | undefined

/** 一条队列日志。上游把四个字段都补成字符串(缺失记成空串),不透出 null。 */
interface QueueLog {
  level: string
  message: string
  source: string
  timestamp: string
}

interface RequestInput {
  base: string
  body?: Json
  headers?: Record<string, string>
  method?: 'GET' | 'POST' | 'PUT'
  path: string
  query?: Record<string, QueryValue>
}

/**
 * 出参侧的字符串:**不**去空白。cursor / response_url 是上游给的不透明值,trim 它们等于
 * 悄悄改写上游数据;入参侧才用 `text()`。
 */
function str(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined
}

function objectArray(value: unknown): Json[] {
  if (!Array.isArray(value)) return []
  return value.map(item => record(item)).filter((item): item is Json => item !== undefined)
}

/** 上游 `normalizeStringOrArray`:单串原样(**不**去空白),数组逐项转字符串。 */
function stringOrArray(value: string | string[] | undefined): string | string[] | undefined {
  if (value === undefined || typeof value === 'string') return value
  return value.map(item => String(item))
}

/**
 * 队列请求的路径。
 *
 * **有意偏离上游**:上游 `encodeURIComponent(String(input.modelId))` 把整个 modelId 当一个
 * 路径段编码,而 fal 的 modelId 就是 `namespace/name`(如 `fal-ai/flux`)—— 斜杠被编成
 * `%2F` 后 `queue.fal.run` 路由匹配不上,凡是带命名空间的模型这四个 action 全都打不通。
 * 故这里**逐段**编码:结构性的 `/` 保留,段内的特殊字符照样转义。requestId 是单个段,
 * 仍整体编码。
 */
function queueRequestPath(modelId: string, requestId: string, suffix?: string): string {
  const model = modelId.split('/').map(segment => encodeURIComponent(segment)).join('/')
  const base = `/${model}/requests/${encodeURIComponent(requestId)}`
  return suffix === undefined ? base : `${base}/${suffix}`
}

function buildUrl(base: string, path: string, query: Record<string, QueryValue> | undefined): string {
  const url = new URL(`${base}${path}`)
  for (const [key, value] of Object.entries(query ?? {})) {
    if (value === undefined) continue
    if (Array.isArray(value)) {
      // 多值靠重复同名参数表达,不能拼成一个逗号串。
      for (const item of value) url.searchParams.append(key, item)
      continue
    }
    url.searchParams.set(key, String(value))
  }
  return url.toString()
}

/**
 * fal 错误体 → 消息。三个位置都可能有:`message`、`error`(字符串)、`detail`
 * (字符串或对象,FastAPI 校验错误走这里)。
 */
function errorMessage(payload: unknown, status: number): string {
  const body = record(payload)
  if (body !== undefined) {
    const detail = typeof body.detail === 'string'
      ? body.detail
      : record(body.detail) !== undefined || Array.isArray(body.detail)
        ? JSON.stringify(body.detail)
        : undefined
    const message = text(body.message) ?? text(body.error) ?? detail
    if (message !== undefined && message !== '') return message
  }
  return `fal.ai 返回 HTTP ${status}`
}

/**
 * 发一次请求并解出 JSON。
 *
 * **有意偏离上游**的一处:上游把 404 与 422 一并压成 400。本仓库的 `upstreamError` 是
 * 1300 个 provider 共用的归一表,404 归 `not_found` —— "模型/请求 id 不存在"和"参数非法"
 * 对调用方是两件事,压成一码后 agent 无从区分。422 两边都是 `invalid_argument`,无差异。
 */
async function request(ctx: ProviderContext, input: RequestInput): Promise<unknown> {
  const result = await http.request({
    baseUrl: input.base,
    path: input.path,
    method: input.method ?? (input.body === undefined ? 'GET' : 'POST'),
    query: Object.entries(input.query ?? {}) satisfies ProviderQuery,
    headers: {
      'authorization': `Key ${requireApiKey(ctx, SERVICE)}`,
      'content-type': 'application/json',
      ...input.headers,
    },
    ...(input.body === undefined ? {} : { json: input.body }),
    invalidJsonMessage: 'fal.ai 返回了非 JSON 响应',
    mapError: ({ bodyKind, data, status }) => upstreamError(
      status,
      errorMessage(bodyKind === 'json' ? data : null, status),
    ),
  })
  return result.data === undefined ? null : result.data
}

/** 契约说好是对象;不是就是上游出问题,不是调用方的错。 */
function requireRecord(value: unknown): Json {
  const result = record(value)
  if (result === undefined) throw new TBError('unavailable', 'fal.ai 响应不是对象', { retryable: true })
  return result
}

function queueLogs(value: unknown): QueueLog[] {
  return objectArray(value).map(item => ({
    message: typeof item.message === 'string' ? item.message : '',
    level: typeof item.level === 'string' ? item.level : '',
    source: typeof item.source === 'string' ? item.source : '',
    timestamp: typeof item.timestamp === 'string' ? item.timestamp : '',
  }))
}

/** 分页三件套:上游对每个列表接口都补齐这三个字段,缺失时给稳定的兜底值。 */
function page(payload: unknown, key: 'models' | 'prices'): Json {
  const result = requireRecord(payload)
  return {
    [key]: objectArray(result[key]),
    hasMore: result.has_more === true,
    nextCursor: str(result.next_cursor) ?? null,
  }
}

export async function getModels(input: z.infer<typeof getModelsInput>, ctx: ProviderContext): Promise<Json> {
  const payload = await request(ctx, {
    base: PLATFORM_BASE,
    path: '/v1/models',
    query: compact<QueryValue>({
      q: text(input.q),
      limit: input.limit,
      cursor: text(input.cursor),
      expand: stringOrArray(input.expand),
      status: text(input.status),
      category: text(input.category),
      endpoint_id: stringOrArray(input.endpointId),
    }),
  })
  return page(payload, 'models')
}

export async function getPricing(input: z.infer<typeof getPricingInput>, ctx: ProviderContext): Promise<Json> {
  const payload = await request(ctx, {
    base: PLATFORM_BASE,
    path: '/v1/models/pricing',
    query: { endpoint_id: stringOrArray(input.endpointId) },
  })
  return page(payload, 'prices')
}

/**
 * 上游在这里断言 `estimateType` 必填并抛 400。schema 里它是**必填 enum**,Zod 在进 handler
 * 之前就拦下了,故不重复断言(重复的那份是死代码,而死代码会被当成还在生效的防线)。
 */
export async function estimatePricing(
  input: z.infer<typeof estimatePricingInput>,
  ctx: ProviderContext,
): Promise<Json> {
  const payload = requireRecord(await request(ctx, {
    base: PLATFORM_BASE,
    method: 'POST',
    path: '/v1/models/pricing/estimate',
    body: {
      estimate_type: input.estimateType,
      endpoints: input.endpoints,
    },
  }))
  return {
    estimateType: str(payload.estimate_type) ?? '',
    totalCost: typeof payload.total_cost === 'number' ? payload.total_cost : 0,
    currency: str(payload.currency) ?? '',
  }
}

export async function getJwks(_input: z.infer<typeof getJwksInput>, ctx: ProviderContext): Promise<Json> {
  const payload = requireRecord(await request(ctx, {
    base: PLATFORM_BASE,
    path: '/.well-known/jwks.json',
  }))
  return { keys: objectArray(payload.keys) }
}

export async function queueGetStatus(
  input: z.infer<typeof queueGetStatusInput>,
  ctx: ProviderContext,
): Promise<Json> {
  const payload = requireRecord(await request(ctx, {
    base: QUEUE_BASE,
    path: queueRequestPath(input.modelId, input.requestId, 'status'),
    // logs: 0 是显式值,要发;只有"没给"才不发。
    query: compact<QueryValue>({ logs: input.logs }),
  }))
  return {
    status: str(payload.status) ?? '',
    responseUrl: str(payload.response_url) ?? null,
    queuePosition: typeof payload.queue_position === 'number' ? payload.queue_position : null,
    logs: queueLogs(payload.logs),
  }
}

/**
 * SSE 事件切分。上游把整个响应体读完再切,不做流式转发 —— 一次工具调用要回一个终值,
 * 中间过程作为 `updates` 一并给出。故这里也是"读完再切"。
 */
function parseSseEvents(payload: string): Array<{ data: string, event: string | undefined }> {
  return payload.split(/\r?\n\r?\n/).flatMap((chunk) => {
    const lines = chunk.split(/\r?\n/).map(line => line.trimEnd()).filter(line => line.length > 0)
    if (lines.length === 0) return []
    let event: string | undefined
    const data: string[] = []
    for (const line of lines) {
      // `:` 开头是注释(SSE 的心跳常用它),整行丢掉。
      if (line.startsWith(':')) continue
      if (line.startsWith('event:')) {
        event = line.slice('event:'.length).trim()
        continue
      }
      if (line.startsWith('data:')) data.push(line.slice('data:'.length).trim())
    }
    return [{ event, data: data.join('\n') }]
  })
}

export async function queueGetStatusStream(
  input: z.infer<typeof queueGetStatusStreamInput>,
  ctx: ProviderContext,
): Promise<Json> {
  const response = await guardedFetch(
    buildUrl(
      QUEUE_BASE,
      queueRequestPath(input.modelId, input.requestId, 'status/stream'),
      compact<QueryValue>({ logs: input.logs }),
    ),
    {
      method: 'GET',
      headers: {
        'accept': 'text/event-stream',
        'authorization': `Key ${requireApiKey(ctx, SERVICE)}`,
        'content-type': 'application/json',
      },
    },
  )

  const body = await response.text()
  if (!response.ok) {
    let payload: unknown = null
    try {
      payload = JSON.parse(body)
    } catch {
      // 流式端点的错误体常是纯文本,归一时只用状态。
    }
    throw upstreamError(response.status, errorMessage(payload, response.status))
  }

  const updates = parseSseEvents(body).flatMap((event) => {
    if (event.data === '') return []
    try {
      return [requireRecord(JSON.parse(event.data))]
    } catch {
      // 非 JSON 的 data 不丢弃:原样留成 {event, data},否则流里的自定义事件在出参里
      // 凭空消失,调用方看不出"发生过但没解析"和"没发生过"的区别。
      return [{ event: event.event ?? 'message', data: event.data }]
    }
  })
  const last = updates.at(-1)

  return {
    updates,
    finalStatus: last === undefined ? null : str(last.status) ?? null,
    responseUrl: last === undefined ? null : str(last.response_url) ?? null,
  }
}

export async function getQueueRequestResult(
  input: z.infer<typeof getQueueRequestResultInput>,
  ctx: ProviderContext,
): Promise<Json> {
  const payload = requireRecord(await request(ctx, {
    base: QUEUE_BASE,
    path: queueRequestPath(input.modelId, input.requestId),
  }))
  return {
    status: str(payload.status) ?? '',
    logs: queueLogs(payload.logs),
    response: record(payload.response) ?? {},
  }
}

export async function cancelQueueRequest(
  input: z.infer<typeof cancelQueueRequestInput>,
  ctx: ProviderContext,
): Promise<Json> {
  const payload = requireRecord(await request(ctx, {
    base: QUEUE_BASE,
    method: 'PUT',
    path: queueRequestPath(input.modelId, input.requestId, 'cancel'),
  }))
  return { status: str(payload.status) ?? '' }
}
