/**
 * Lightfield 的业务逻辑。
 *
 * 迁移自 open-connector `src/providers/lightfield/executors.ts`,语义等价、写法本地化:
 * 凭证从 `ctx.upstreamAuth` 取,出站走 `guardedFetch`,错误抛 `TBError` 七码。
 *
 * 十个 action 全是 GET,形状高度同构(三个 CRM 实体 + 自定义对象各一组 list/get,
 * 外加一个 key 元数据),故请求/归一化都收在下面几个 helper 里。
 *
 * 三处刻意偏离上游,记在这里:
 * - 上游 `createLightfieldError` 自带一套状态重映射(404/422 压成 400、403 抬成 401),
 *   这里改用共享的 `upstreamError` 按**原始状态**归一。跨 provider 一致的错误语义比逐家
 *   口径更有用,而且 404 被说成"参数非法"本来就会误导调用方。
 * - 上游每个请求带 `mode: 'validate' | 'execute'` 来切换错误分支,`validate` 只服务凭证
 *   验证器(不在 action 表里、不迁),故这里没有 mode。
 * - 上游把"API key 未激活"报成 400。这里报 unavailable,与 `requireApiKey` 缺凭证时的口径
 *   一致 —— 两者都是挂载配置的问题,不是调用方的入参错。
 */

import type { z } from 'zod/v4'
import { TBError } from '@tool-bridge/plugin-sdk'
import type {
  getAccountInput,
  getApiKeyMetadataInput,
  getContactInput,
  getCustomObjectRecordInput,
  getOpportunityInput,
  listAccountsInput,
  listContactsInput,
  listCustomObjectRecordsInput,
  listObjectDefinitionsInput,
  listOpportunitiesInput,
} from './schema'
import { type ProviderContext, requireApiKey } from '../_runtime/plugin'
import { upstreamError } from '../_runtime/upstreamError'
import { guardedFetch } from '../_runtime/guardedFetch'

const SERVICE = 'lightfield'
const API_BASE = 'https://api.lightfield.app'
const API_VERSION = '2026-03-01'

const ACCOUNTS_PATH = '/v1/accounts'
const CONTACTS_PATH = '/v1/contacts'
const OPPORTUNITIES_PATH = '/v1/opportunities'
const OBJECTS_PATH = '/v1/objects'
const VALIDATE_PATH = '/v1/auth/validate'

interface ApiKeyMetadata {
  active: true
  scopes: string[]
  subjectType: 'user' | 'workspace'
  tokenType: 'api_key'
}

/** 三张列表 schema 共有的分页/过滤部分(`list_custom_object_records` 多一个 entitySlug)。 */
interface ListQueryInput {
  filters?: Record<string, boolean | number | string>
  limit?: number
  offset?: number
}

interface ListRecordsResult {
  object: string
  records: unknown[]
  totalCount: number
}

/** 上游响应形状不符合约定:不是调用方的错,归 unavailable。 */
function contractError(label: string): TBError {
  return new TBError('unavailable', `Lightfield 返回的${label}不符合约定`, { retryable: true })
}

function readRecord(payload: unknown, label: string): Record<string, unknown> {
  if (payload === null || typeof payload !== 'object' || Array.isArray(payload)) {
    throw contractError(label)
  }
  return payload as Record<string, unknown>
}

function readArrayProperty(payload: unknown, key: string, label: string): unknown[] {
  const value = readRecord(payload, label)[key]
  if (!Array.isArray(value)) throw contractError(label)
  return value
}

function readStringProperty(record: Record<string, unknown>, key: string, label: string): string {
  const value = record[key]
  if (typeof value !== 'string') throw contractError(label)
  return value
}

function readNumberProperty(record: Record<string, unknown>, key: string, label: string): number {
  const value = record[key]
  if (typeof value !== 'number') throw contractError(label)
  return value
}

/**
 * 响应体尽力解析。错误响应回纯文本是 Lightfield 的常态,原样留着给 `errorMessage` 取;
 * 成功响应回不了 JSON 才是契约破了。
 */
async function readPayload(response: Response): Promise<unknown> {
  const text = await response.text().catch(() => '')
  if (text.trim() === '') return null
  try {
    return JSON.parse(text) as unknown
  } catch {
    if (response.ok) throw contractError('响应体')
    return text
  }
}

/** 错误体里找人话消息:Lightfield 各端点用的键不统一,四个都试。 */
function errorMessage(payload: unknown, response: Response): string {
  if (typeof payload === 'string' && payload.trim() !== '') return payload
  if (payload !== null && typeof payload === 'object' && !Array.isArray(payload)) {
    const record = payload as Record<string, unknown>
    for (const key of ['message', 'error', 'detail', 'title']) {
      const value = record[key]
      if (typeof value === 'string' && value.trim() !== '') return value.trim()
    }
  }
  return response.statusText || `Lightfield 返回 HTTP ${response.status}`
}

/**
 * 路径参数编码。schema 的 `.min(1)` 拦不住全空白串,而上游取值走的 `requiredString` 会先
 * trim —— 不补这一道,`id: ' '` 会被原样编进 URL 打到上游。
 */
function pathSegment(value: string, field: string): string {
  const trimmed = value.trim()
  if (trimmed === '') throw new TBError('invalid_argument', `${field} 不能为空`)
  return encodeURIComponent(trimmed)
}

/**
 * filters 的键是 Lightfield 的原始字段表达式(如 `$email[contains]`),不做转义直接当
 * query 键。用 set 而非 append:与上游一致,filters 里若出现 limit/offset 会覆盖前两行。
 */
function listQuery(input: ListQueryInput): Record<string, string> {
  const query: Record<string, string> = {}
  if (input.limit !== undefined) query.limit = String(input.limit)
  if (input.offset !== undefined) query.offset = String(input.offset)
  for (const [key, value] of Object.entries(input.filters ?? {})) {
    query[key] = String(value)
  }
  return query
}

async function request(
  ctx: ProviderContext,
  path: string,
  query?: Record<string, string>,
): Promise<unknown> {
  // 取凭证放在 try 外:缺 authRef 是配置问题,不该被下面的传输层兜底改写成"上游不可达"。
  const apiKey = requireApiKey(ctx, SERVICE)
  const url = new URL(path, API_BASE)
  for (const [key, value] of Object.entries(query ?? {})) {
    url.searchParams.set(key, value)
  }

  let response: Response
  let payload: unknown
  try {
    response = await guardedFetch(url.toString(), {
      method: 'GET',
      headers: {
        'accept': 'application/json',
        'authorization': `Bearer ${apiKey}`,
        'lightfield-version': API_VERSION,
      },
    })
    payload = await readPayload(response)
  } catch (error) {
    if (error instanceof TBError) throw error
    // 传输层失败(含 guardedFetch 的出站拦截):上游不可达,不是调用方的错。
    const detail = error instanceof Error ? `: ${error.message}` : ''
    throw new TBError('unavailable', `Lightfield 请求失败${detail}`, { retryable: true })
  }

  if (!response.ok) throw upstreamError(response.status, errorMessage(payload, response))
  return payload
}

/** 上游把列表包在 `{data, object, totalCount}` 里,这里摊平成 records/object/totalCount。 */
function normalizeListPayload(payload: unknown): ListRecordsResult {
  const record = readRecord(payload, '列表响应')
  return {
    records: readArrayProperty(record, 'data', '列表响应'),
    object: readStringProperty(record, 'object', '列表响应'),
    totalCount: readNumberProperty(record, 'totalCount', '列表响应'),
  }
}

/**
 * key 元数据的四个字段都是 outputSchema 里的 required,上游给不出就不能当成功放行。
 * `active !== true` 单独归 unavailable(见文件头注释),其余形状问题归契约破裂。
 */
function readApiKeyMetadata(payload: unknown): ApiKeyMetadata {
  const label = 'API key 元数据'
  const record = readRecord(payload, label)
  const { active, scopes, subjectType, tokenType } = record
  if (active !== true) {
    throw new TBError('unavailable', 'Lightfield API key 未激活')
  }
  if (subjectType !== 'user' && subjectType !== 'workspace') throw contractError(label)
  if (tokenType !== 'api_key') throw contractError(label)
  if (!Array.isArray(scopes) || !scopes.every(scope => typeof scope === 'string')) {
    throw contractError(label)
  }
  return { active, scopes: scopes as string[], subjectType, tokenType }
}

async function listRecords(
  path: string,
  input: ListQueryInput,
  ctx: ProviderContext,
): Promise<ListRecordsResult> {
  return normalizeListPayload(await request(ctx, path, listQuery(input)))
}

async function getRecord(
  path: string,
  id: string,
  ctx: ProviderContext,
): Promise<{ record: unknown }> {
  return { record: await request(ctx, `${path}/${pathSegment(id, 'id')}`) }
}

export async function getApiKeyMetadata(
  _input: z.infer<typeof getApiKeyMetadataInput>,
  ctx: ProviderContext,
): Promise<ApiKeyMetadata> {
  return readApiKeyMetadata(await request(ctx, VALIDATE_PATH))
}

export async function listObjectDefinitions(
  _input: z.infer<typeof listObjectDefinitionsInput>,
  ctx: ProviderContext,
): Promise<{ definitions: unknown[] }> {
  const payload = await request(ctx, OBJECTS_PATH)
  return { definitions: readArrayProperty(payload, 'data', '对象定义列表') }
}

// —— 自定义对象 ——

export async function listCustomObjectRecords(
  input: z.infer<typeof listCustomObjectRecordsInput>,
  ctx: ProviderContext,
): Promise<ListRecordsResult> {
  const path = `${OBJECTS_PATH}/${pathSegment(input.entitySlug, 'entitySlug')}`
  return normalizeListPayload(await request(ctx, path, listQuery(input)))
}

export async function getCustomObjectRecord(
  input: z.infer<typeof getCustomObjectRecordInput>,
  ctx: ProviderContext,
): Promise<{ record: unknown }> {
  const slug = pathSegment(input.entitySlug, 'entitySlug')
  const id = pathSegment(input.id, 'id')
  return { record: await request(ctx, `${OBJECTS_PATH}/${slug}/values/${id}`) }
}

// —— accounts ——

export async function listAccounts(
  input: z.infer<typeof listAccountsInput>,
  ctx: ProviderContext,
): Promise<ListRecordsResult> {
  return listRecords(ACCOUNTS_PATH, input, ctx)
}

export async function getAccount(
  input: z.infer<typeof getAccountInput>,
  ctx: ProviderContext,
): Promise<{ record: unknown }> {
  return getRecord(ACCOUNTS_PATH, input.id, ctx)
}

// —— contacts ——

export async function listContacts(
  input: z.infer<typeof listContactsInput>,
  ctx: ProviderContext,
): Promise<ListRecordsResult> {
  return listRecords(CONTACTS_PATH, input, ctx)
}

export async function getContact(
  input: z.infer<typeof getContactInput>,
  ctx: ProviderContext,
): Promise<{ record: unknown }> {
  return getRecord(CONTACTS_PATH, input.id, ctx)
}

// —— opportunities ——

export async function listOpportunities(
  input: z.infer<typeof listOpportunitiesInput>,
  ctx: ProviderContext,
): Promise<ListRecordsResult> {
  return listRecords(OPPORTUNITIES_PATH, input, ctx)
}

export async function getOpportunity(
  input: z.infer<typeof getOpportunityInput>,
  ctx: ProviderContext,
): Promise<{ record: unknown }> {
  return getRecord(OPPORTUNITIES_PATH, input.id, ctx)
}
