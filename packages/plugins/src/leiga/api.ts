/**
 * Leiga 的业务逻辑。
 *
 * 迁移自 open-connector `src/providers/leiga/executors.ts`,语义等价、写法本地化:
 * 凭证从 `ctx.upstreamAuth` 取(平台经 authRef 注入,插件不自持),出站走 `guardedFetch`,
 * 错误抛 `TBError` 七码。
 *
 * Leiga 的两个特点决定了这里的形状:
 * - 响应是 `{code, msg, data}` **信封**,且 `code !== '0'` 可以搭配 HTTP 200 出现 ——
 *   只看 `response.ok` 会把失败当成功,故成功判定必须同时看两者。
 * - 凭证走 `accessToken` 头,不是 Bearer。
 *
 * 上游 `createLeigaError` 按"校验期/执行期"把 4xx 压成 400 的分支不保留:状态码归一
 * 由共用的 `upstreamError` 统一口径。保留的是 `code` → 状态的换算,那是 Leiga 特有的。
 */

import type { z } from 'zod/v4'
import { TBError } from '@tool-bridge/plugin-sdk'
import type {
  getIssueByNumberInput,
  getIssueSchemaInput,
  getProjectByKeyInput,
  getProjectInput,
  listIssuesInput,
  listProjectsInput,
} from './schema'
import { type ProviderContext, requireApiKey } from '../_runtime/plugin'
import { upstreamError } from '../_runtime/upstreamError'
import { guardedFetch } from '../_runtime/guardedFetch'

const SERVICE = 'leiga'
const API_BASE = 'https://app.leiga.com/openapi/api'
const REQUEST_TIMEOUT_MS = 30_000

type Json = Record<string, unknown>

interface NormalizedProject {
  archived: number | null
  id: number
  owner: Json | null
  pkey: string | null
  pname: string | null
  raw: Json
}

interface NormalizedIssue {
  description: string | null
  id: number | null
  issueId: number | null
  issueNo: string | null
  projectId: number | null
  raw: Json
  statusName: string | null
  summary: string | null
}

interface NormalizedIssueField {
  fieldId: string
  fieldName: string
  fieldType: string
  options: unknown[] | null
  required: boolean
}

interface NormalizedIssueSchema {
  fields: NormalizedIssueField[]
  id: number | null
  name: string | null
  raw: Json
}

function asRecord(value: unknown): Json | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Json)
    : undefined
}

/** 上游 `optionalString` 的语义:先 trim,空则视为缺失。 */
function optionalText(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  return trimmed === '' ? undefined : trimmed
}

function optionalInteger(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isInteger(value) ? value : undefined
}

/** 响应里契约要求的字段;取不到是**上游**破了契约,不是调用方的错。 */
function responseRecord(value: unknown, label: string): Json {
  const record = asRecord(value)
  if (record === undefined) throw upstreamError(502, `Leiga 返回的 ${label} 不是对象`)
  return record
}

function responseText(value: unknown, label: string): string {
  const text = optionalText(value)
  if (text === undefined) throw upstreamError(502, `Leiga 响应缺少 ${label}`)
  return text
}

function responseInteger(value: unknown, label: string): number {
  const integer = optionalInteger(value)
  if (integer === undefined) throw upstreamError(502, `Leiga 响应的 ${label} 不是整数`)
  return integer
}

function nullableInteger(value: unknown): number | null {
  return value === null || value === undefined ? null : responseInteger(value, 'integer')
}

/**
 * 信封里的 `code` 是 Leiga 自己的错误码。HTTP 已经是 4xx/5xx 时以 HTTP 为准;
 * HTTP 200 却带非零 code 时,code 本身像个 HTTP 状态就用它,否则一律按 400。
 */
function errorStatus(httpStatus: number, code: string): number {
  if (httpStatus >= 400) return httpStatus
  const providerStatus = Number(code)
  return Number.isInteger(providerStatus) && providerStatus >= 400 ? providerStatus : 400
}

function errorMessage(payload: unknown): string | undefined {
  const record = asRecord(payload)
  if (record !== undefined) return optionalText(record.msg) ?? optionalText(record.message)
  return optionalText(payload)
}

async function readPayload(response: Response): Promise<unknown> {
  const text = await response.text()
  if (text.trim() === '') return null
  try {
    return JSON.parse(text) as unknown
  } catch {
    throw upstreamError(502, 'Leiga 返回了非法 JSON')
  }
}

interface RequestInput {
  body?: Json
  method: 'GET' | 'POST'
  path: string
  query?: Record<string, string | undefined>
}

/** 返回信封本体(`{code, msg, data}`);业务字段由各 handler 从 `.data` 取。 */
async function request(ctx: ProviderContext, input: RequestInput): Promise<Json> {
  const apiKey = requireApiKey(ctx, SERVICE)
  // 上游按 `new URL(path, base + '/')` 拼,故这里去掉前导斜杠,否则会丢掉 /openapi/api 前缀。
  const url = new URL(input.path.replace(/^\//, ''), `${API_BASE}/`)
  for (const [key, value] of Object.entries(input.query ?? {})) {
    if (value !== undefined) url.searchParams.set(key, value)
  }

  const timeoutSignal = AbortSignal.timeout(REQUEST_TIMEOUT_MS)
  let response: Response
  try {
    response = await guardedFetch(url.toString(), {
      method: input.method,
      headers: {
        'accept': 'application/json',
        'accessToken': apiKey,
        'content-type': 'application/json',
      },
      signal: timeoutSignal,
      ...(input.body === undefined ? {} : { body: JSON.stringify(input.body) }),
    })
  } catch (error) {
    // 传输层失败必须就地归一:漏出去的裸 Error 会被 plugin-sdk 抹成 "internal plugin error"
    // 500,把"上游不通/出网被拦"说成插件自身故障,还丢掉唯一有诊断价值的那句消息。
    if (timeoutSignal.aborted) throw upstreamError(504, 'Leiga 请求超时')
    throw upstreamError(502, error instanceof Error ? `Leiga 请求失败: ${error.message}` : 'Leiga 请求失败')
  }

  const payload = await readPayload(response)
  if (!response.ok) {
    throw upstreamError(
      response.status,
      errorMessage(payload) ?? `Leiga 请求失败(HTTP ${response.status})`,
    )
  }

  const record = responseRecord(payload, 'response')
  const rawCode = record.code
  const code = optionalText(rawCode)
    ?? (typeof rawCode === 'number' && Number.isFinite(rawCode) ? String(rawCode) : undefined)
  if (code !== undefined && code !== '0') {
    throw upstreamError(
      errorStatus(response.status, code),
      errorMessage(record) ?? `Leiga 返回错误码 ${code}`,
    )
  }
  return record
}

function normalizeProject(value: unknown): NormalizedProject {
  const record = responseRecord(value, 'project')
  return {
    id: responseInteger(record.id, 'project id'),
    pname: optionalText(record.pname) ?? null,
    pkey: optionalText(record.pkey) ?? null,
    archived: nullableInteger(record.archived),
    owner: asRecord(record.owner) ?? null,
    raw: record,
  }
}

function normalizeIssue(value: unknown): NormalizedIssue {
  const record = responseRecord(value, 'issue')
  return {
    id: nullableInteger(record.id),
    issueId: nullableInteger(record.issueId),
    issueNo: optionalText(record.issueNo) ?? null,
    summary: optionalText(record.summary) ?? null,
    description: optionalText(record.description) ?? null,
    statusName: optionalText(record.statusName) ?? null,
    projectId: nullableInteger(record.projectId),
    raw: record,
  }
}

function normalizeIssueField(value: unknown): NormalizedIssueField {
  const record = responseRecord(value, 'issue schema field')
  if (typeof record.required !== 'boolean') {
    throw upstreamError(502, 'Leiga 响应的 required 不是布尔')
  }
  return {
    fieldId: responseText(record.fieldId, 'fieldId'),
    fieldName: responseText(record.fieldName, 'fieldName'),
    fieldType: responseText(record.fieldType, 'fieldType'),
    required: record.required,
    options: Array.isArray(record.options) ? record.options : null,
  }
}

/**
 * 路径/query 参数在 schema 里是 optional(生成器照搬了上游 action 定义),但发请求前
 * 必须是正整数,否则会打出 `projectId=undefined`。
 */
function requirePositiveInteger(value: number | undefined, field: string): string {
  if (value === undefined || !Number.isInteger(value) || value <= 0) {
    throw new TBError('invalid_argument', `${field} 必须是正整数`)
  }
  return String(value)
}

function requireText(value: string | undefined, field: string): string {
  const text = optionalText(value)
  if (text === undefined) throw new TBError('invalid_argument', `${field} 不能为空`)
  return text
}

export async function listProjects(
  input: z.infer<typeof listProjectsInput>,
  ctx: ProviderContext,
): Promise<{ projects: NormalizedProject[], raw: Json, total: number }> {
  const payload = await request(ctx, {
    method: 'GET',
    path: '/project/list',
    query: {
      ...(input.id === undefined ? {} : { id: String(input.id) }),
      ...(input.pname === undefined ? {} : { pname: input.pname }),
      ...(input.pkey === undefined ? {} : { pkey: input.pkey }),
      ...(input.archived === undefined ? {} : { archived: String(input.archived) }),
    },
  })

  const projects = Array.isArray(payload.data) ? payload.data.map(item => normalizeProject(item)) : []
  // total 是**本次返回的**条数,不是全量计数 —— 上游就这么算的,保留。
  return { projects, total: projects.length, raw: payload }
}

export async function getProject(
  input: z.infer<typeof getProjectInput>,
  ctx: ProviderContext,
): Promise<{ project: NormalizedProject }> {
  const payload = await request(ctx, {
    method: 'GET',
    path: '/project/info',
    query: { projectId: requirePositiveInteger(input.projectId, 'projectId') },
  })
  return { project: normalizeProject(payload.data) }
}

export async function getProjectByKey(
  input: z.infer<typeof getProjectByKeyInput>,
  ctx: ProviderContext,
): Promise<{ project: NormalizedProject }> {
  const payload = await request(ctx, {
    method: 'GET',
    path: '/project/info-by-key',
    query: { projectKey: requireText(input.projectKey, 'projectKey') },
  })
  return { project: normalizeProject(payload.data) }
}

export async function listIssues(
  input: z.infer<typeof listIssuesInput>,
  ctx: ProviderContext,
): Promise<{ issues: NormalizedIssue[], raw: Json, total: number }> {
  const payload = await request(ctx, {
    method: 'POST',
    path: '/issue/page',
    body: {
      projectId: input.projectId,
      pageNumber: input.pageNumber,
      pageSize: input.pageSize,
      ...(input.summary === undefined ? {} : { summary: input.summary }),
      ...(input.orderBy === undefined ? {} : { orderBy: input.orderBy }),
      ...(input.sort === undefined ? {} : { sort: input.sort }),
      ...(input.statusTypes === undefined ? {} : { statusTypes: input.statusTypes }),
      ...(input.showedCustomFieldCodes === undefined
        ? {}
        : { showedCustomFieldCodes: input.showedCustomFieldCodes }),
    },
  })

  const data = responseRecord(payload.data, 'issue list data')
  return {
    total: responseInteger(data.total, 'total'),
    issues: Array.isArray(data.list) ? data.list.map(item => normalizeIssue(item)) : [],
    raw: payload,
  }
}

export async function getIssueByNumber(
  input: z.infer<typeof getIssueByNumberInput>,
  ctx: ProviderContext,
): Promise<{ issue: NormalizedIssue }> {
  const payload = await request(ctx, {
    method: 'GET',
    path: '/issue/detail-by-no',
    query: { issueNo: requireText(input.issueNo, 'issueNo') },
  })
  return { issue: normalizeIssue(payload.data) }
}

export async function getIssueSchema(
  input: z.infer<typeof getIssueSchemaInput>,
  ctx: ProviderContext,
): Promise<{ schema: NormalizedIssueSchema }> {
  const payload = await request(ctx, {
    method: 'GET',
    path: '/issue/schema',
    query: { projectId: requirePositiveInteger(input.projectId, 'projectId') },
  })

  const record = responseRecord(payload.data, 'issue schema')
  return {
    schema: {
      id: nullableInteger(record.id),
      name: optionalText(record.name) ?? null,
      fields: (Array.isArray(record.fields) ? record.fields : []).map(item => normalizeIssueField(item)),
      raw: record,
    },
  }
}
