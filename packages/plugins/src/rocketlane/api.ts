/**
 * Rocketlane 的业务逻辑。
 *
 * 迁移自 open-connector `src/providers/rocketlane/executors.ts`,语义等价、写法本地化:
 * 凭证从 `ctx.upstreamAuth` 取(平台经 authRef 注入,插件不自持),出站走 `guardedFetch`,
 * 错误抛 `TBError` 七码。
 *
 * Rocketlane 的两个特点决定了这里的形状:
 * - 过滤器的 query 键带**点号**(`projectName.eq`、`status.oneOf`),与入参名不同形,
 *   映射表是这套约定的唯一实现;数组值用逗号拼成一个值,不是重复同名键。
 * - 凭证走自定义头 `api-key`,不是 Authorization Bearer。
 *
 * 与上游的有意偏离:上游 `createRocketlaneError` 的 validate 分支把 4xx 全压成 401,
 * execute 分支又把 5xx 压成 502;这里把原始状态原样交给 `upstreamError` 统一归一。
 */

import type { z } from 'zod/v4'
import type {
  getProjectInput,
  getTaskInput,
  getUserInput,
  listProjectsInput,
  listTasksInput,
  listUsersInput,
} from './schema'
import { type ProviderContext, requireApiKey } from '../_runtime/plugin'
import { upstreamError } from '../_runtime/upstreamError'
import { guardedFetch } from '../_runtime/guardedFetch'

const SERVICE = 'rocketlane'
const API_BASE = 'https://api.rocketlane.com/api'

type Json = Record<string, unknown>
type QueryValue = boolean | number | string | readonly string[] | undefined

/** 上游 `optionalString` 的等价物:非字符串、或去空白后为空,都算缺失。 */
function text(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  return trimmed === '' ? undefined : trimmed
}

function record(value: unknown, label: string): Json {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    // 契约说好是对象;不是就是上游破了契约,不是调用方的错。
    throw upstreamError(502, `${label} is missing or invalid`)
  }
  return value as Json
}

function recordArray(value: unknown, label: string): Json[] {
  if (!Array.isArray(value)) throw upstreamError(502, `${label} must be an array`)
  return value.map((item, index) => record(item, `${label}[${index}]`))
}

/** 数组值逗号拼接成**一个** query 值 —— Rocketlane 不认重复同名键。 */
function buildUrl(path: string, query: Record<string, QueryValue>): URL {
  const url = new URL(path.replace(/^\//, ''), `${API_BASE}/`)
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined) continue
    url.searchParams.set(key, Array.isArray(value) ? value.join(',') : String(value))
  }
  return url
}

/** Rocketlane 在部分错误上回空体;空体不该被当成解析失败。 */
async function readJson(response: Response): Promise<unknown> {
  const body = await response.text()
  if (body.trim() === '') return null
  try {
    return JSON.parse(body) as unknown
  } catch {
    throw upstreamError(502, 'Rocketlane returned invalid JSON')
  }
}

/** 错误体有四种形状:纯文本、`{errorMessage|message|error}`、以及 `{errors:[...]}` 数组。 */
function errorMessage(payload: unknown): string | undefined {
  if (typeof payload === 'string') return text(payload)
  if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) return undefined
  const body = payload as Json
  const direct = text(body.errorMessage) ?? text(body.message) ?? text(body.error)
  if (direct !== undefined) return direct
  if (Array.isArray(body.errors)) {
    for (const item of body.errors) {
      if (typeof item !== 'object' || item === null) continue
      const entry = item as Json
      const message = text(entry.errorMessage) ?? text(entry.message) ?? text(entry.error)
      if (message !== undefined) return message
    }
  }
  return undefined
}

async function request(ctx: ProviderContext, path: string, query: Record<string, QueryValue>): Promise<Json> {
  // 取凭证放在 try 外:它抛的是配置错误,不该被下面的传输失败兜底吞成 502。
  const apiKey = requireApiKey(ctx, SERVICE)

  let response: Response
  try {
    response = await guardedFetch(buildUrl(path, query).toString(), {
      method: 'GET',
      headers: { 'accept': 'application/json', 'api-key': apiKey },
    })
  } catch (error) {
    // 传输层失败必须就地归一:漏出去的裸 Error 会被 plugin-sdk 抹成 "internal plugin error"
    // 500,把"上游不通/出网被拦"说成插件自身故障,还丢掉唯一有诊断价值的那句消息。
    throw upstreamError(502, error instanceof Error ? `Rocketlane request failed: ${error.message}` : 'Rocketlane request failed')
  }

  const payload = await readJson(response)
  if (!response.ok) {
    throw upstreamError(response.status, errorMessage(payload) ?? `Rocketlane request failed with status ${response.status}`)
  }
  return record(payload, 'Rocketlane response')
}

/** list 接口统一的 `{data,pagination}` 信封;两个键都必须在,否则算上游破契约。 */
function listEnvelope(payload: Json, label: string): { data: Json[], pagination: Json } {
  return {
    data: recordArray(payload.data, `${label} data`),
    pagination: record(payload.pagination, `${label} pagination`),
  }
}

/** 详情接口共用的两个 query 参数。 */
function detailQuery(input: { includeAllFields?: boolean, includeFields?: readonly string[] }): Record<string, QueryValue> {
  return { includeFields: input.includeFields, includeAllFields: input.includeAllFields }
}

export async function listProjects(
  input: z.infer<typeof listProjectsInput>,
  ctx: ProviderContext,
): Promise<Json> {
  const payload = await request(ctx, '/1.0/projects', {
    'pageSize': input.pageSize,
    'pageToken': input.pageToken,
    'includeFields': input.includeFields,
    'includeAllFields': input.includeAllFields,
    'sortBy': input.sortBy,
    'sortOrder': input.sortOrder,
    'match': input.match,
    'projectName.eq': input.projectNameEq,
    'projectName.cn': input.projectNameContains,
    'status.eq': input.statusEq,
    'status.oneOf': input.statusOneOf,
    'startDate.gt': input.startDateGt,
    'startDate.ge': input.startDateGe,
    'dueDate.lt': input.dueDateLt,
    'customerId.eq': input.customerIdEq,
  })
  const { data, pagination } = listEnvelope(payload, 'Rocketlane projects')
  return {
    projects: data.map((item, index) => record(item, `Rocketlane project[${index}]`)),
    pagination,
  }
}

export async function getProject(
  input: z.infer<typeof getProjectInput>,
  ctx: ProviderContext,
): Promise<Json> {
  const payload = await request(ctx, `/1.0/projects/${input.projectId}`, detailQuery(input))
  return { project: payload }
}

export async function listTasks(
  input: z.infer<typeof listTasksInput>,
  ctx: ProviderContext,
): Promise<Json> {
  const payload = await request(ctx, '/1.0/tasks', {
    'pageSize': input.pageSize,
    'pageToken': input.pageToken,
    'includeFields': input.includeFields,
    'includeAllFields': input.includeAllFields,
    'sortBy': input.sortBy,
    'sortOrder': input.sortOrder,
    'match': input.match,
    'taskName.eq': input.taskNameEq,
    'taskName.cn': input.taskNameContains,
    'task.status.eq': input.taskStatusEq,
    'task.status.oneOf': input.taskStatusOneOf,
    'projectId.eq': input.projectIdEq,
    'startDate.gt': input.startDateGt,
    'dueDate.lt': input.dueDateLt,
    'atRisk.eq': input.atRiskEq,
  })
  const { data, pagination } = listEnvelope(payload, 'Rocketlane tasks')
  return {
    tasks: data.map((item, index) => record(item, `Rocketlane task[${index}]`)),
    pagination,
  }
}

export async function getTask(
  input: z.infer<typeof getTaskInput>,
  ctx: ProviderContext,
): Promise<Json> {
  const payload = await request(ctx, `/1.0/tasks/${input.taskId}`, detailQuery(input))
  return { task: payload }
}

export async function listUsers(
  input: z.infer<typeof listUsersInput>,
  ctx: ProviderContext,
): Promise<Json> {
  const payload = await request(ctx, '/1.0/users', {
    'pageSize': input.pageSize,
    'pageToken': input.pageToken,
    'includeFields': input.includeFields,
    'includeAllFields': input.includeAllFields,
    'sortBy': input.sortBy,
    'sortOrder': input.sortOrder,
    'match': input.match,
    'firstName.eq': input.firstNameEq,
    'firstName.cn': input.firstNameContains,
    'email.eq': input.emailEq,
    'email.cn': input.emailContains,
    // status.eq / type.eq 在上游也是数组入参(schema 限死 max(1)),照旧走逗号拼接。
    'status.eq': input.statusEq,
    'status.oneOf': input.statusOneOf,
    'type.eq': input.typeEq,
    'permissionId.eq': input.permissionIdEq,
  })
  const { data, pagination } = listEnvelope(payload, 'Rocketlane users')
  return {
    users: data.map((item, index) => record(item, `Rocketlane user[${index}]`)),
    pagination,
  }
}

export async function getUser(
  input: z.infer<typeof getUserInput>,
  ctx: ProviderContext,
): Promise<Json> {
  const payload = await request(ctx, `/1.0/users/${input.userId}`, detailQuery(input))
  return { user: payload }
}
