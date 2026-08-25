/**
 * Pipedrive 的业务逻辑。
 *
 * 迁移自 open-connector `src/providers/pipedrive/runtime.ts`,语义等价、写法本地化:
 * 凭证从 `ctx.upstreamAuth` 取(平台经 authRef 注入,插件不自持),出站走 `guardedFetch`,
 * 错误抛 `TBError` 七码。
 *
 * 凭证在 **`x-api-token` 请求头**里,不在 URL 上(Pipedrive 也支持 `?api_token=` 的
 * query 写法,上游没用,这里也不用 —— 凭证进 URL 会落进各级访问日志)。
 *
 * 27 个 action 是同一台状态机的 27 组参数,故这里照抄上游的**操作表**写法:
 * 一张 `OPERATIONS` 表描述 method / 路径 / id 字段 / 出参形状,一个 `execute` 跑完全部。
 * 逐个手写 27 份近乎相同的 handler 只会让"某一个漏了 snake_case 转换"这类错误藏得更深。
 *
 * 四处上游细节决定了这里的形状:
 * - **入参键要转 snake_case**(`personId` → `person_id`)。Pipedrive 的字段名是蛇形,
 *   而 action 入参声明是驼峰;漏了这一步的表现不是报错,而是**字段被静默忽略** ——
 *   create 出一条只有默认值的记录,没人会立刻发现。
 * - **GET 与写操作的取舍规则不同**:query 只收标量(数组/对象拼不进 query string,null 视为
 *   未给),body 则只丢 `undefined`(`null` 要留着 —— Pipedrive 用它表示"清空该字段")。
 * - 响应是 `{success, data, additional_data.pagination.next_cursor}` 信封。**`success: false`
 *   可以带着 HTTP 200 回来**,那是失败,不能当成功返回。
 * - `{id}` 路径段的 id 字段在 schema 里全是 optional(生成器忠实反映了上游的 loose 声明),
 *   但拼 URL 前必须是正整数,否则会打出 `/api/v2/persons/undefined`。
 *
 * 与上游的两处有意偏离:
 * - 上游 `createPipedriveError` 按"校验期/执行期"压状态码(带 id 的 action 把 404 压成 400、
 *   5xx 一律压成 502),这里不保留:状态码归一由共用的 `upstreamError` 统一口径,每个
 *   provider 各压一套正是它要消灭的东西 —— 于是 404 如实回 `not_found`。
 * - GET / DELETE 不再发 `content-type`(没有请求体的请求带它没有意义)。
 */

import { TBError } from '@tool-bridge/plugin-sdk'
import { asJsonObject as asRecord, trimmedText as optionalText } from '../_runtime/jsonValue'
import { type ProviderContext, requireApiKey } from '../_runtime/plugin'
import { createProviderHttpClient } from '../_runtime/providerHttp'
import { upstreamError } from '../_runtime/upstreamError'

const SERVICE = 'pipedrive'
const API_BASE = 'https://api.pipedrive.com'
const http = createProviderHttpClient({ baseUrl: `${API_BASE}/`, service: SERVICE })

type Json = Record<string, unknown>
type Method = 'DELETE' | 'GET' | 'PATCH' | 'POST'
type Query = Record<string, string | undefined>

interface Operation {
  /** 入参里承载 `{id}` 路径段的字段名(驼峰);有它就意味着这个 action 认 id。 */
  idField?: string
  /** 单条资源的出参键:`{[itemKey]: data}`。 */
  itemKey?: string
  /** 列表出参键:`{[listKey]: data[], nextCursor}`。 */
  listKey?: string
  method: Method
  path: string
  /** search 端点:出参是 `{items, nextCursor}`,且 `term` 必填。 */
  search?: boolean
}

/**
 * action 名 → 操作参数。键集合必须与 `schema.ts` 的 `pipedriveActions` 完全一致
 * (对不上会在装配期炸,见 `_runtime/plugin.ts`)。
 *
 * 没有 listKey / itemKey / search 的那几个就是 delete,出参走 `{id, deleted, raw}`。
 */
const OPERATIONS: Record<string, Operation> = {
  list_persons: { method: 'GET', path: '/api/v2/persons', listKey: 'persons' },
  get_person: { method: 'GET', path: '/api/v2/persons/{id}', idField: 'personId', itemKey: 'person' },
  create_person: { method: 'POST', path: '/api/v2/persons', itemKey: 'person' },
  update_person: { method: 'PATCH', path: '/api/v2/persons/{id}', idField: 'personId', itemKey: 'person' },
  delete_person: { method: 'DELETE', path: '/api/v2/persons/{id}', idField: 'personId' },
  search_persons: { method: 'GET', path: '/api/v2/persons/search', search: true },
  list_organizations: { method: 'GET', path: '/api/v2/organizations', listKey: 'organizations' },
  get_organization: {
    method: 'GET',
    path: '/api/v2/organizations/{id}',
    idField: 'organizationId',
    itemKey: 'organization',
  },
  create_organization: { method: 'POST', path: '/api/v2/organizations', itemKey: 'organization' },
  update_organization: {
    method: 'PATCH',
    path: '/api/v2/organizations/{id}',
    idField: 'organizationId',
    itemKey: 'organization',
  },
  delete_organization: { method: 'DELETE', path: '/api/v2/organizations/{id}', idField: 'organizationId' },
  search_organizations: { method: 'GET', path: '/api/v2/organizations/search', search: true },
  list_deals: { method: 'GET', path: '/api/v2/deals', listKey: 'deals' },
  get_deal: { method: 'GET', path: '/api/v2/deals/{id}', idField: 'dealId', itemKey: 'deal' },
  create_deal: { method: 'POST', path: '/api/v2/deals', itemKey: 'deal' },
  update_deal: { method: 'PATCH', path: '/api/v2/deals/{id}', idField: 'dealId', itemKey: 'deal' },
  delete_deal: { method: 'DELETE', path: '/api/v2/deals/{id}', idField: 'dealId' },
  search_deals: { method: 'GET', path: '/api/v2/deals/search', search: true },
  list_activities: { method: 'GET', path: '/api/v2/activities', listKey: 'activities' },
  get_activity: { method: 'GET', path: '/api/v2/activities/{id}', idField: 'activityId', itemKey: 'activity' },
  create_activity: { method: 'POST', path: '/api/v2/activities', itemKey: 'activity' },
  update_activity: {
    method: 'PATCH',
    path: '/api/v2/activities/{id}',
    idField: 'activityId',
    itemKey: 'activity',
  },
  delete_activity: { method: 'DELETE', path: '/api/v2/activities/{id}', idField: 'activityId' },
  list_pipelines: { method: 'GET', path: '/api/v2/pipelines', listKey: 'pipelines' },
  get_pipeline: { method: 'GET', path: '/api/v2/pipelines/{id}', idField: 'pipelineId', itemKey: 'pipeline' },
  list_stages: { method: 'GET', path: '/api/v2/stages', listKey: 'stages' },
  get_stage: { method: 'GET', path: '/api/v2/stages/{id}', idField: 'stageId', itemKey: 'stage' },
}

function requiredText(value: unknown, field: string): string {
  const text = optionalText(value)
  if (text === undefined) throw new TBError('invalid_argument', `${field} 不能为空`)
  return text
}

/** `personId` → `person_id`。Pipedrive 的字段名是蛇形,action 入参声明是驼峰。 */
function toSnakeCase(value: string): string {
  return value.replace(/[A-Z]/g, letter => `_${letter.toLowerCase()}`)
}

/**
 * `{id}` 路径段的值。schema 上是 optional(甚至 update_* 的入参整个是 looseObject,
 * 连声明都没有),但拼 URL 前必须是正整数 —— 缺了就会打出 `/api/v2/persons/undefined`。
 * 归 invalid_argument:这是调用方少给了参数,不是上游故障。
 */
function requiredPositiveInteger(value: unknown, field: string): string {
  if (typeof value === 'number' && Number.isSafeInteger(value) && value > 0) return String(value)
  throw new TBError('invalid_argument', `${field} 必须是正整数`)
}

function buildPath(operation: Operation, input: Json): string {
  if (operation.idField === undefined) return operation.path
  // 值已被 requiredPositiveInteger 收成十进制整数串,不含需要转义的字符。
  return operation.path.replace('{id}', requiredPositiveInteger(input[operation.idField], operation.idField))
}

/** GET 的 query:只收标量(数组/对象拼不进 query string),`null` 与 `undefined` 都算未给。 */
function buildQuery(operation: Operation, input: Json): Query {
  const query: Query = {}
  for (const [key, value] of Object.entries(input)) {
    if (key === operation.idField) continue
    if (value === undefined || value === null || typeof value === 'object') continue
    query[toSnakeCase(key)] = String(value)
  }
  if (operation.search === true) {
    // search 端点没有 term 就是一次必然失败的往返。上游允许用 `query` 当 `term` 的别名,
    // 且**两个键都会发出去** —— 保留这个行为:调用方可能靠 `query` 命中别的语义。
    //
    // 与上游的一处偏离:纯空白的 term 上游会原样发出去(它只判 `!query.term`,拦不住
    // 空白串),这里按 trim 后为空处理、当场拒 —— 空查询打上游同样是必然失败。
    query.term = requiredText(input.term ?? input.query, 'term')
  }
  return query
}

/** POST / PATCH 的 body:只丢 `undefined`,`null` 要留着(Pipedrive 用它表示"清空该字段")。 */
function buildBody(operation: Operation, input: Json): Json {
  const body: Json = {}
  for (const [key, value] of Object.entries(input)) {
    if (key === operation.idField || value === undefined) continue
    body[toSnakeCase(key)] = value
  }
  return body
}

function errorMessage(payload: unknown): string | undefined {
  if (typeof payload === 'string') return optionalText(payload)
  const record = asRecord(payload)
  if (record === undefined) return undefined
  return optionalText(record.error)
    ?? optionalText(record.error_info)
    ?? optionalText(record.message)
    ?? optionalText(record.statusText)
}

async function request(ctx: ProviderContext, operation: Operation, input: Json): Promise<Json> {
  const apiKey = requireApiKey(ctx, SERVICE)
  const hasBody = operation.method === 'POST' || operation.method === 'PATCH'
  const headers: Record<string, string> = {
    'accept': 'application/json',
    'x-api-token': apiKey,
  }
  const response = await http.request({
    method: operation.method,
    path: buildPath(operation, input),
    headers,
    ...(operation.method === 'GET' ? { query: Object.entries(buildQuery(operation, input)) } : {}),
    ...(hasBody ? { json: buildBody(operation, input) } : {}),
    invalidJson: 'text',
    mapError: ({ data, status, statusText }) => upstreamError(
      status,
      errorMessage(data) ?? (statusText || `pipedrive 返回 HTTP ${status}`),
    ),
    mapTransportError: ({ message }) => upstreamError(
      502,
      message === undefined ? 'pipedrive 请求失败' : `pipedrive 请求失败: ${message}`,
    ),
  })

  // 空体(DELETE 常见)按空信封处理;非 JSON 或非对象则是上游破了契约。
  const record = response.bodyKind === 'empty' ? {} : asRecord(response.data)
  if (record === undefined) throw upstreamError(502, 'pipedrive 返回的响应不是 JSON 对象')
  if (record.success === false) {
    // 信封式失败:HTTP 200 也可能带 `success: false`,那是失败,不能当成功返回。
    throw upstreamError(502, errorMessage(record) ?? 'pipedrive 报告了一次失败的响应')
  }
  return record
}

/** 响应里契约要求是对象的位置;不是就是上游破了契约,不是调用方的错。 */
function responseRecord(value: unknown, field: string): Json {
  const record = asRecord(value)
  if (record === undefined) throw upstreamError(502, `pipedrive 响应的 ${field} 不是对象`)
  return record
}

/** 游标在 `additional_data.pagination.next_cursor`;没有下一页时如实回 `null`。 */
function nextCursor(envelope: Json): string | null {
  const pagination = asRecord(asRecord(envelope.additional_data)?.pagination)
  return optionalText(pagination?.next_cursor) ?? null
}

function shapeOutput(envelope: Json, operation: Operation): Json {
  const data = envelope.data
  if (operation.listKey !== undefined) {
    // 上游对"data 不是数组"是宽容的(回空列表)。保留:Pipedrive 在没有匹配项时
    // 回过 `data: null`,把它当成上游故障会让一次正常的空查询变成 503。
    return { [operation.listKey]: Array.isArray(data) ? data : [], nextCursor: nextCursor(envelope) }
  }
  if (operation.itemKey !== undefined) {
    return { [operation.itemKey]: responseRecord(data, 'data') }
  }
  if (operation.search === true) {
    const searchData = responseRecord(data, 'data')
    return { items: Array.isArray(searchData.items) ? searchData.items : [], nextCursor: nextCursor(envelope) }
  }
  // 剩下的是 delete_*:Pipedrive 只回被删对象的 id。
  const deleted = asRecord(data)
  const id = deleted?.id
  return {
    // id 通常是整数;不是整数时如实透出原值,而不是伪造成 null —— 调用方要能看见上游给了什么。
    id: id === undefined ? null : id,
    deleted: true,
    raw: data ?? null,
  }
}

async function execute(operation: Operation, input: Json, ctx: ProviderContext): Promise<Json> {
  return shapeOutput(await request(ctx, operation, input), operation)
}

/** action 名 → handler。由操作表展开,故表与 handler 表不可能对不上。 */
export const pipedriveHandlers: Record<
  string,
  (input: Json, ctx: ProviderContext) => Promise<Json>
> = Object.fromEntries(
  Object.entries(OPERATIONS).map(([name, operation]) => [
    name,
    (input: Json, ctx: ProviderContext) => execute(operation, input, ctx),
  ]),
)
