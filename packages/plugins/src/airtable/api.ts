/**
 * Airtable 的业务逻辑。
 *
 * 迁移自 open-connector `src/providers/airtable/executors.ts`,语义等价、写法本地化:
 * 凭证从 `ctx.upstreamAuth` 取(平台经 authRef 注入,插件不自持),出站走 `guardedFetch`,
 * 错误抛 `TBError` 七码。
 *
 * 凭证走 **header**(`authorization: Bearer <pat>`),不进 URL。
 *
 * 四处上游细节决定了这里的形状:
 * - Airtable 的 query 用 **PHP 风格的方括号编码**:数组是重复的 `fields[]`,排序是
 *   `sort[0][field]` / `sort[0][direction]` 这种带下标的键。故 query 必须是**有序的
 *   键值对数组**而不是对象 —— 同名键会重复出现,对象表达不了。
 * - `list_records` 的 GET 会被长 `filterByFormula` 撑爆 URL,上游在**拼完 URL 后**量长度,
 *   超过 15000 就改打 `POST /listRecords`,同一批参数换成 JSON body。这个阈值与"先拼再量"
 *   的顺序都要照抄:换算方式不同会让临界请求在两条路径间抖动。
 * - 写接口的请求体是**逐字段挑选**而不是整体透传:`create_field` 要先把路径参数
 *   (baseId/tableId/columnId)从体里删掉,否则 Airtable 会把它们当成字段属性拒掉。
 * - 出参统一裹一层(`{records, offset}` / `{base}` / `{record}`),且 `offset` 缺席时是
 *   **null 而不是字段缺席** —— 调用方靠它判"还有没有下一页"。
 *
 * 与上游的有意偏离:
 * - 上游 `createAirtableError` 只认 401/403/404/422/429,**其余一律压成 502**(包括上游
 *   自己回的 400)。这里把原始状态交给 `upstreamError`,400 仍是 invalid_argument、
 *   404 仍是 not_found、409 仍是 conflict —— 把一个"参数写错了"报成可重试的 502,
 *   agent 会对一个永远不会变的结果反复重试。
 * - 上游的 `mode: 'validate'` 分支只服务 `credentialValidators`(把 401/403 说成 400)。
 *   平台侧的 credentialProbe 自己做这层分账,故不迁。
 * - 不发 `user-agent`:上游那个值标识的是 open-connector 进程,在这里已无意义。
 */

import type { z } from 'zod/v4'
import { TBError } from '@tool-bridge/plugin-sdk'
import type {
  createBaseInput,
  createFieldInput,
  createRecordsInput,
  createTableInput,
  deleteBaseInput,
  deleteRecordsInput,
  getBaseCollaboratorsInput,
  getBaseSchemaInput,
  getRecordInput,
  listBasesInput,
  listRecordsInput,
  updateFieldInput,
  updateRecordsInput,
  updateTableInput,
} from './schema'
import {
  booleanValue as boolean,
  compactDefined as compact,
  integerValue as integer,
  asJsonObject as record,
  trimmedText as text,
} from '../_runtime/jsonValue'
import { createProviderHttpClient, type ProviderHttpErrorContext, type ProviderHttpResult } from '../_runtime/providerHttp'
import { type ProviderContext, requireApiKey } from '../_runtime/plugin'
import { upstreamError } from '../_runtime/upstreamError'

const SERVICE = 'airtable'
const API_BASE = 'https://api.airtable.com'
const BASES_PATH = '/v0/meta/bases'
const http = createProviderHttpClient({ baseUrl: API_BASE, service: SERVICE })
/**
 * 超过这个长度就改用 POST 端点。Airtable 自己的 URL 上限更高,留出余量是因为长度要在
 * 拼出完整 URL 后才知道,而重定向、代理都可能再加几个字节。
 */
const GET_URL_LENGTH_SOFT_LIMIT = 15_000

type Json = Record<string, unknown>
/** 有序键值对:同名键会重复出现(`fields[]`),对象表达不了。 */
type Query = Array<[string, string]>

/** 上游 `requireString`:纯空白能过 Zod 的 `min(1)`,打到上游就是一次必然失败的请求。 */
function requireText(value: unknown, field: string): string {
  const result = text(value)
  if (result === undefined) throw new TBError('invalid_argument', `${field} is required`)
  return result
}

/** 契约说好是 JSON 对象;不是就是上游出问题,不是调用方的错。 */
function requireObject(value: unknown, label: string): Json {
  const fields = record(value)
  if (fields === undefined) throw upstreamError(502, `${label} must be a plain object`)
  return fields
}

/** 上游 `objectArray`:非数组当空数组,数组里混了非对象则算上游违约。 */
function objectArray(value: unknown, label: string): Json[] {
  if (!Array.isArray(value)) return []
  return value.map((item, index) => requireObject(item, `${label}[${index}]`))
}

/** 调用方给的数组元素必须是对象,错的是入参而不是上游。 */
function inputObject(value: unknown, label: string): Json {
  const fields = record(value)
  if (fields === undefined) throw new TBError('invalid_argument', `${label} must be an object`)
  return fields
}

function buildUrl(path: string, query: Query | undefined): string {
  const url = new URL(path, API_BASE)
  for (const [key, value] of query ?? []) url.searchParams.append(key, value)
  return url.toString()
}

/** Airtable 的错误体是 `{error:{type, message}}`;网关层的错误可能是纯文本。 */
function errorMessage(payload: unknown, status: number): string {
  if (typeof payload === 'string' && payload !== '') return payload
  const error = record(record(payload)?.error)
  const message = text(error?.message)
  const type = text(error?.type)
  if (message !== undefined && type !== undefined) return `${message} (${type})`
  return message ?? type ?? `airtable request failed with ${status}`
}

interface RequestInput {
  body?: Json
  method?: 'DELETE' | 'GET' | 'PATCH' | 'POST'
  path: string
  query?: Query
}

function responsePayload(result: Pick<ProviderHttpResult, 'bodyKind' | 'data' | 'headers' | 'status'>): unknown {
  const contentType = result.headers.get('content-type') ?? ''
  if (contentType.includes('application/json')) {
    if (result.bodyKind === 'json') return result.data
    if (result.bodyKind === 'empty' && (result.status === 204 || result.status === 205)) return null
    throw upstreamError(502, 'airtable response parsing failed: invalid JSON')
  }
  if (result.bodyKind === 'empty') return null
  if (result.bodyKind === 'text') {
    try {
      return JSON.parse(String(result.data)) as unknown
    } catch {
      return result.data
    }
  }
  return result.data
}

function mapAirtableError(context: ProviderHttpErrorContext): TBError {
  try {
    return upstreamError(context.status, errorMessage(responsePayload(context), context.status))
  } catch {
    return upstreamError(502, 'airtable response parsing failed: invalid JSON')
  }
}

async function request(ctx: ProviderContext, input: RequestInput): Promise<unknown> {
  // 取凭证放在 try 外:它抛的是配置错误,不该被下面的传输失败兜底吞成 502。
  const apiKey = requireApiKey(ctx, SERVICE)
  const result = await http.request({
    path: input.path,
    method: input.method ?? 'GET',
    query: input.query,
    headers: { accept: 'application/json', authorization: `Bearer ${apiKey}` },
    ...(input.body === undefined ? {} : { json: input.body }),
    invalidJson: 'text',
    responseType: 'auto',
    mapError: mapAirtableError,
    mapTransportError: ({ message }) => upstreamError(
      502,
      `airtable request failed: ${message ?? 'unknown request error'}`,
    ),
  })
  return responsePayload(result)
}

function recordCollectionPath(input: { baseId?: string, tableIdOrName?: string }): string {
  const baseId = encodeURIComponent(requireText(input.baseId, 'baseId'))
  const table = encodeURIComponent(requireText(input.tableIdOrName, 'tableIdOrName'))
  return `/v0/${baseId}/${table}`
}

/** `include` 在 query 上是重复的 `include[]`,不是逗号串。 */
function includeQuery(include: readonly string[] | undefined): Query {
  return (include ?? []).map(item => ['include[]', requireText(item, 'include item')] as [string, string])
}

/** list_records 与 get_record 共用的读参数。 */
function commonReadQuery(input: {
  cellFormat?: string
  fields?: readonly string[]
  includeDateDependencyMetadata?: boolean
  returnFieldsByFieldId?: boolean
  timeZone?: string
  userLocale?: string
}): Query {
  const query: Query = []
  for (const field of input.fields ?? []) query.push(['fields[]', requireText(field, 'fields item')])

  const cellFormat = text(input.cellFormat)
  const timeZone = text(input.timeZone)
  const userLocale = text(input.userLocale)
  const returnFieldsByFieldId = boolean(input.returnFieldsByFieldId)
  const includeDateDependencyMetadata = boolean(input.includeDateDependencyMetadata)

  if (cellFormat !== undefined) query.push(['cellFormat', cellFormat])
  if (timeZone !== undefined) query.push(['timeZone', timeZone])
  if (userLocale !== undefined) query.push(['userLocale', userLocale])
  if (returnFieldsByFieldId !== undefined) query.push(['returnFieldsByFieldId', String(returnFieldsByFieldId)])
  if (includeDateDependencyMetadata !== undefined) {
    query.push(['includeDateDependencyMetadata', String(includeDateDependencyMetadata)])
  }
  return query
}

type ListRecordsInput = z.infer<typeof listRecordsInput>

function listRecordsQuery(input: ListRecordsInput): Query {
  const query = commonReadQuery(input)
  const offset = text(input.offset)
  const pageSize = integer(input.pageSize)
  const maxRecords = integer(input.maxRecords)
  const view = text(input.view)
  const filterByFormula = text(input.filterByFormula)

  if (offset !== undefined) query.push(['offset', offset])
  if (pageSize !== undefined) query.push(['pageSize', String(pageSize)])
  if (maxRecords !== undefined) query.push(['maxRecords', String(maxRecords)])
  if (view !== undefined) query.push(['view', view])
  if (filterByFormula !== undefined) query.push(['filterByFormula', filterByFormula])

  // 排序用带下标的键表达顺序:`sort[0][field]`、`sort[0][direction]`。
  for (const [index, item] of (input.sort ?? []).entries()) {
    const rule = inputObject(item, `sort[${index}]`)
    query.push([`sort[${index}][field]`, requireText(rule.field, `sort[${index}].field`)])
    const direction = text(rule.direction)
    if (direction !== undefined) query.push([`sort[${index}][direction]`, direction])
  }

  for (const item of input.recordMetadata ?? []) {
    query.push(['recordMetadata[]', requireText(item, 'recordMetadata item')])
  }
  return query
}

/** URL 过长时改走的 POST 体:同一批参数,换成 JSON 的常规命名。 */
function listRecordsPostBody(input: ListRecordsInput): Json {
  return compact({
    view: text(input.view),
    fields: input.fields === undefined
      ? undefined
      : input.fields.map(field => requireText(field, 'fields item')),
    sort: input.sort === undefined
      ? undefined
      : input.sort.map((item, index) => {
          const rule = inputObject(item, `sort[${index}]`)
          return compact({
            field: requireText(rule.field, `sort[${index}].field`),
            direction: text(rule.direction),
          })
        }),
    filterByFormula: text(input.filterByFormula),
    maxRecords: integer(input.maxRecords),
    pageSize: integer(input.pageSize),
    offset: text(input.offset),
    cellFormat: text(input.cellFormat),
    timeZone: text(input.timeZone),
    userLocale: text(input.userLocale),
    returnFieldsByFieldId: boolean(input.returnFieldsByFieldId),
    includeDateDependencyMetadata: boolean(input.includeDateDependencyMetadata),
    recordMetadata: input.recordMetadata === undefined
      ? undefined
      : input.recordMetadata.map(item => requireText(item, 'recordMetadata item')),
  })
}

/**
 * 字段配置:路径参数不能混进体里(Airtable 会把 baseId 当成一个未知的字段属性拒掉),
 * 其余键原样透传 —— 各字段类型的 options 形状差异太大,枚举不完。
 */
function fieldConfig(value: unknown, label: string): Json {
  const field = { ...inputObject(value, label) }
  delete field.baseId
  delete field.tableId
  delete field.columnId

  return compact({
    ...field,
    name: requireText(field.name, `${label}.name`),
    type: requireText(field.type, `${label}.type`),
    description: text(field.description),
    options: record(field.options),
  })
}

function fieldConfigs(value: unknown, label: string): Json[] {
  const fields = Array.isArray(value) ? value : []
  if (fields.length === 0) throw new TBError('invalid_argument', `${label} is required`)
  return fields.map((field, index) => fieldConfig(field, `${label}[${index}]`))
}

function tableConfigs(value: unknown): Json[] {
  const tables = Array.isArray(value) ? value : []
  if (tables.length === 0) throw new TBError('invalid_argument', 'tables is required')
  return tables.map((table, index) => {
    const config = inputObject(table, `tables[${index}]`)
    return compact({
      ...config,
      name: requireText(config.name, `tables[${index}].name`),
      description: text(config.description),
      fields: fieldConfigs(config.fields, `tables[${index}].fields`),
    })
  })
}

function recordFields(value: unknown, label: string): Json {
  const fields = record(value)
  if (fields === undefined) throw new TBError('invalid_argument', `${label} must be an object`)
  return fields
}

export async function listBases(
  input: z.infer<typeof listBasesInput>,
  ctx: ProviderContext,
): Promise<Json> {
  const offset = text(input.offset)
  const payload = requireObject(
    await request(ctx, { path: BASES_PATH, query: offset === undefined ? [] : [['offset', offset]] }),
    'airtable list bases response',
  )
  return {
    bases: objectArray(payload.bases, 'bases'),
    // 翻页靠它:没有下一页时给 null,压成 undefined 会让调用方分不清"到底了"。
    offset: text(payload.offset) ?? null,
  }
}

export async function getBaseCollaborators(
  input: z.infer<typeof getBaseCollaboratorsInput>,
  ctx: ProviderContext,
): Promise<Json> {
  const payload = await request(ctx, {
    path: `${BASES_PATH}/${encodeURIComponent(requireText(input.baseId, 'baseId'))}`,
    query: includeQuery(input.include),
  })
  return { base: requireObject(payload, 'airtable get base collaborators response') }
}

export async function getBaseSchema(
  input: z.infer<typeof getBaseSchemaInput>,
  ctx: ProviderContext,
): Promise<Json> {
  const payload = requireObject(
    await request(ctx, {
      path: `${BASES_PATH}/${encodeURIComponent(requireText(input.baseId, 'baseId'))}/tables`,
      query: includeQuery(input.include),
    }),
    'airtable get base schema response',
  )
  return { tables: Array.isArray(payload.tables) ? payload.tables : [] }
}

export async function createBase(
  input: z.infer<typeof createBaseInput>,
  ctx: ProviderContext,
): Promise<Json> {
  const payload = await request(ctx, {
    method: 'POST',
    path: BASES_PATH,
    body: {
      name: requireText(input.name, 'name'),
      workspaceId: requireText(input.workspaceId, 'workspaceId'),
      tables: tableConfigs(input.tables),
    },
  })
  return requireObject(payload, 'airtable create base response')
}

export async function deleteBase(
  input: z.infer<typeof deleteBaseInput>,
  ctx: ProviderContext,
): Promise<Json> {
  const payload = await request(ctx, {
    method: 'DELETE',
    path: `${BASES_PATH}/${encodeURIComponent(requireText(input.baseId, 'baseId'))}`,
  })
  return requireObject(payload, 'airtable delete base response')
}

export async function createTable(
  input: z.infer<typeof createTableInput>,
  ctx: ProviderContext,
): Promise<Json> {
  const payload = await request(ctx, {
    method: 'POST',
    path: `${BASES_PATH}/${encodeURIComponent(requireText(input.baseId, 'baseId'))}/tables`,
    body: compact({
      name: requireText(input.name, 'name'),
      description: text(input.description),
      fields: fieldConfigs(input.fields, 'fields'),
    }),
  })
  return requireObject(payload, 'airtable create table response')
}

export async function updateTable(
  input: z.infer<typeof updateTableInput>,
  ctx: ProviderContext,
): Promise<Json> {
  const baseId = encodeURIComponent(requireText(input.baseId, 'baseId'))
  const table = encodeURIComponent(requireText(input.tableIdOrName, 'tableIdOrName'))
  const payload = await request(ctx, {
    method: 'PATCH',
    path: `${BASES_PATH}/${baseId}/tables/${table}`,
    body: compact({
      name: text(input.name),
      description: text(input.description),
      dateDependencySettings: record(input.dateDependencySettings),
    }),
  })
  return requireObject(payload, 'airtable update table response')
}

export async function createField(
  input: z.infer<typeof createFieldInput>,
  ctx: ProviderContext,
): Promise<Json> {
  const baseId = encodeURIComponent(requireText(input.baseId, 'baseId'))
  const tableId = encodeURIComponent(requireText(input.tableId, 'tableId'))
  const payload = await request(ctx, {
    method: 'POST',
    path: `${BASES_PATH}/${baseId}/tables/${tableId}/fields`,
    body: fieldConfig(input, 'field'),
  })
  return requireObject(payload, 'airtable create field response')
}

export async function updateField(
  input: z.infer<typeof updateFieldInput>,
  ctx: ProviderContext,
): Promise<Json> {
  const baseId = encodeURIComponent(requireText(input.baseId, 'baseId'))
  const tableId = encodeURIComponent(requireText(input.tableId, 'tableId'))
  const columnId = encodeURIComponent(requireText(input.columnId, 'columnId'))
  const payload = await request(ctx, {
    method: 'PATCH',
    path: `${BASES_PATH}/${baseId}/tables/${tableId}/fields/${columnId}`,
    body: compact({
      name: text(input.name),
      description: text(input.description),
      options: record(input.options),
    }),
  })
  return requireObject(payload, 'airtable update field response')
}

export async function listRecords(
  input: ListRecordsInput,
  ctx: ProviderContext,
): Promise<Json> {
  const path = recordCollectionPath(input)
  const query = listRecordsQuery(input)
  // 先拼出完整 URL 再量长度:长 filterByFormula 会把 GET 撑爆,那时换 POST 端点。
  const usePost = buildUrl(path, query).length >= GET_URL_LENGTH_SOFT_LIMIT

  const payload = requireObject(
    await request(ctx, usePost
      ? { method: 'POST', path: `${path}/listRecords`, body: listRecordsPostBody(input) }
      : { path, query }),
    'airtable list records response',
  )
  return {
    records: objectArray(payload.records, 'records'),
    offset: text(payload.offset) ?? null,
  }
}

export async function getRecord(
  input: z.infer<typeof getRecordInput>,
  ctx: ProviderContext,
): Promise<Json> {
  const payload = await request(ctx, {
    path: `${recordCollectionPath(input)}/${encodeURIComponent(requireText(input.recordId, 'recordId'))}`,
    query: commonReadQuery(input),
  })
  return { record: requireObject(payload, 'airtable get record response') }
}

export async function createRecords(
  input: z.infer<typeof createRecordsInput>,
  ctx: ProviderContext,
): Promise<Json> {
  const records = Array.isArray(input.records) ? input.records : []
  if (records.length === 0) throw new TBError('invalid_argument', 'records is required')

  const payload = requireObject(
    await request(ctx, {
      method: 'POST',
      path: recordCollectionPath(input),
      body: compact({
        // 创建时只发 fields:带上 id 会被 Airtable 当成非法字段。
        records: records.map((item, index) => ({
          fields: recordFields(inputObject(item, `records[${index}]`).fields, `records[${index}].fields`),
        })),
        typecast: boolean(input.typecast),
        returnFieldsByFieldId: boolean(input.returnFieldsByFieldId),
      }),
    }),
    'airtable create records response',
  )
  return { records: objectArray(payload.records, 'records') }
}

export async function updateRecords(
  input: z.infer<typeof updateRecordsInput>,
  ctx: ProviderContext,
): Promise<Json> {
  const records = Array.isArray(input.records) ? input.records : []
  if (records.length === 0) throw new TBError('invalid_argument', 'records is required')

  const payload = requireObject(
    await request(ctx, {
      method: 'PATCH',
      path: recordCollectionPath(input),
      body: compact({
        records: records.map((item, index) => {
          const entry = inputObject(item, `records[${index}]`)
          return {
            id: requireText(entry.id, `records[${index}].id`),
            fields: recordFields(entry.fields, `records[${index}].fields`),
          }
        }),
        typecast: boolean(input.typecast),
        returnFieldsByFieldId: boolean(input.returnFieldsByFieldId),
      }),
    }),
    'airtable update records response',
  )
  return { records: objectArray(payload.records, 'records') }
}

export async function deleteRecords(
  input: z.infer<typeof deleteRecordsInput>,
  ctx: ProviderContext,
): Promise<Json> {
  const recordIds = Array.isArray(input.recordIds) ? input.recordIds : []
  if (recordIds.length === 0) throw new TBError('invalid_argument', 'recordIds is required')

  const payload = requireObject(
    await request(ctx, {
      method: 'DELETE',
      path: recordCollectionPath(input),
      // 删除的 id 走 query 的重复 `records[]`,不是请求体。
      query: recordIds.map(id => ['records[]', requireText(id, 'recordIds item')] as [string, string]),
    }),
    'airtable delete records response',
  )
  return { records: objectArray(payload.records, 'records') }
}
