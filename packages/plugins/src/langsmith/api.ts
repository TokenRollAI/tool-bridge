/**
 * LangSmith 的业务逻辑。
 *
 * 迁移自 open-connector `src/providers/langsmith/executors.ts`,语义等价、写法本地化:
 * 凭证从 `ctx.upstreamAuth` 取(平台经 authRef 注入),出站走 `guardedFetch`,
 * 错误抛 `TBError` 七码。凭证在 **`X-Api-Key` 头**,不进 URL。
 *
 * 上游把 `region` 与 `workspaceId` 放在 api_key 的 `extraFields`(两个都 `secret: false`),
 * 这里落到 **`providerConfig`(`ctx.config`)**:按四条凭证通道的分界,region 与 workspace 归属
 * 是配置不是密钥,不该占 secret 通道 —— 否则只为选个区域就得把 API key 改写成 JSON 多字段凭证。
 *
 * 三处上游细节决定了这里的形状:
 * - **region 决定 API base**(us/eu/apac/aws_us 四个不同域名),且 `aws` 是 `aws_us` 的别名。
 *   配错区域是配置问题,归 `invalid_argument`。
 * - **入参名与线上参数名对不上**:`datasetId` 在 list/get example 上是 query 的 **`dataset`**,
 *   在 create example 上是 body 的 **`dataset_id`**;`create_project` 的 `upsert` 进 **query**
 *   而不是 body。照抄上游,不要"看着顺手"改名。
 * - **响应体不一定是 JSON**:空体读成 `null`,解析失败保留原文,错误消息再从原文或
 *   `detail`/`message`/`error`/`title` 里取。
 *
 * 与上游的有意偏离:
 * - 上游 `createLangSmithError` 把 404/422 压成 400、并在校验阶段把 401/403 压成 400。这里把
 *   原始状态原样交给 `upstreamError`(404 仍是 not_found),收敛各 provider 互不相同的错误
 *   口径正是 `_runtime/upstreamError.ts` 存在的理由;平台侧的 credentialProbe 自己做校验期分账。
 * - 不发 `user-agent`:上游那个值标识的是 open-connector 进程,在这里已无意义。
 */

import type { z } from 'zod/v4'
import { TBError } from '@tool-bridge/plugin-sdk'
import type {
  createDatasetInput,
  createExampleInput,
  createProjectInput,
  getDatasetInput,
  getExampleInput,
  getProjectInput,
  listDatasetsInput,
  listExamplesInput,
  listProjectsInput,
  listWorkspacesInput,
} from './schema'
import { type ProviderContext, requireApiKey } from '../_runtime/plugin'
import { upstreamError } from '../_runtime/upstreamError'
import { guardedFetch } from '../_runtime/guardedFetch'

const SERVICE = 'langsmith'
const WORKSPACES_PATH = '/api/v1/workspaces'
const DEFAULT_REGION = 'us'

/** LangSmith SaaS 的四个区域各有独立域名 —— 打错区域是 401 而不是空结果。 */
const REGION_BASE_URLS: Record<string, string> = {
  us: 'https://api.smith.langchain.com',
  eu: 'https://eu.api.smith.langchain.com',
  apac: 'https://apac.api.smith.langchain.com',
  aws_us: 'https://aws.api.smith.langchain.com',
}

type Json = Record<string, unknown>

interface RequestInput {
  body?: Json
  method?: 'GET' | 'POST'
  path: string
  query?: Json
}

/** 上游 `optionalString`:去空白后仍非空才算有值。 */
function text(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  return trimmed === '' ? undefined : trimmed
}

function num(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

/** 上游 `nullableInteger` 的等价物:只认真整数,小数与数字串都算"没有"。 */
function int(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isInteger(value) ? value : undefined
}

function record(value: unknown): Json | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Json) : undefined
}

/** 上游 `compactObject`:丢掉值为 undefined 的键。query 与 body 共用一份。 */
function compact(value: Json): Json {
  return Object.fromEntries(Object.entries(value).filter(([, child]) => child !== undefined))
}

function configError(message: string): TBError {
  return new TBError('invalid_argument', `${SERVICE} 的 ${message}`)
}

/**
 * 解出挂载配置里的区域。上游把 `aws` 当作 `aws_us` 的别名(历史命名),保留;
 * 其余取值一律拒 —— 静默落回 us 会让"配了 eu 却打到 us"变成一个没人发现的数据出境问题。
 */
function resolveApiBase(ctx: ProviderContext): string {
  const configured = ctx.config?.region
  if (configured !== undefined && typeof configured !== 'string') throw configError('region 必须是字符串')
  const raw = text(configured) ?? DEFAULT_REGION
  const region = raw === 'aws' ? 'aws_us' : raw
  const base = REGION_BASE_URLS[region]
  if (base === undefined) throw configError('region 必须是 us、eu、apac 或 aws_us 之一')
  return base
}

/** 一个 API key 能看到多个 workspace 时,靠 `X-Tenant-Id` 指定用哪个。 */
function resolveWorkspaceId(ctx: ProviderContext): string | undefined {
  const configured = ctx.config?.workspaceId
  if (configured !== undefined && typeof configured !== 'string') throw configError('workspaceId 必须是字符串')
  return text(configured)
}

async function readPayload(response: Response): Promise<unknown> {
  const body = await response.text().catch(() => '')
  if (body.trim() === '') return null
  try {
    return JSON.parse(body)
  } catch {
    // 解析失败保留原文:错误响应常是纯文本或 HTML,原文比"响应不是 JSON"有用。
    return body
  }
}

/** 错误消息四处之一;拿不到就退回状态行。 */
function errorMessage(response: Response, payload: unknown): string {
  const fromText = typeof payload === 'string' ? text(payload) : undefined
  const body = record(payload)
  return fromText
    ?? text(body?.detail)
    ?? text(body?.message)
    ?? text(body?.error)
    ?? text(body?.title)
    ?? text(response.statusText)
    ?? `langsmith 返回 HTTP ${response.status}`
}

async function request(ctx: ProviderContext, input: RequestInput): Promise<unknown> {
  // 取凭证与解配置放在 try 外:它们抛的是配置错误,不该被下面的传输失败兜底吞成 502。
  const apiKey = requireApiKey(ctx, SERVICE)
  const url = new URL(input.path, resolveApiBase(ctx))
  const workspaceId = resolveWorkspaceId(ctx)

  for (const [key, value] of Object.entries(input.query ?? {})) {
    if (value === undefined || value === null) continue
    // 数组展开成重复的同名参数(full_text_contains 是多片段搜索,拼成逗号串语义就变了)。
    if (Array.isArray(value)) {
      for (const item of value) {
        if (item !== undefined && item !== null) url.searchParams.append(key, String(item))
      }
      continue
    }
    url.searchParams.set(key, String(value))
  }

  const headers: Record<string, string> = { 'accept': 'application/json', 'X-Api-Key': apiKey }
  if (input.body !== undefined) headers['content-type'] = 'application/json'
  if (workspaceId !== undefined) headers['X-Tenant-Id'] = workspaceId

  let response: Response
  try {
    response = await guardedFetch(url.toString(), {
      method: input.method ?? 'GET',
      headers,
      ...(input.body === undefined ? {} : { body: JSON.stringify(input.body) }),
    })
  } catch (error) {
    // 传输层失败必须就地归一:漏出去的裸 Error 会被 plugin-sdk 抹成 500,
    // 把"上游不通/出网被拦"说成插件自身故障。
    if (error instanceof TBError) throw error
    throw upstreamError(502, `langsmith 请求失败: ${error instanceof Error ? error.message : '未知错误'}`)
  }

  const payload = await readPayload(response)
  if (!response.ok) throw upstreamError(response.status, errorMessage(response, payload))
  return payload
}

function ensureObject(value: unknown, label: string): Json {
  const result = record(value)
  if (result === undefined) {
    // 契约说好是对象;不是就是上游破了契约,不是调用方的错。
    throw new TBError('unavailable', `${label} response is not an object`, { retryable: true })
  }
  return result
}

function ensureObjectArray(value: unknown, label: string): Json[] {
  if (!Array.isArray(value)) {
    throw new TBError('unavailable', `${label} response is not an array`, { retryable: true })
  }
  return value.map(item => ensureObject(item, label))
}

/** 路径段的必填断言:schema 把它声明成 optional(忠实反映上游),但拼进 URL 前必须有值。 */
function requirePathId(value: string | undefined, field: string): string {
  const id = text(value)
  if (id === undefined) throw new TBError('invalid_argument', `${field} 不能为空`)
  return encodeURIComponent(id)
}

function normalizeWorkspace(value: Json): Json {
  return {
    id: String(value.id ?? ''),
    organization_id: text(value.organization_id) ?? null,
    display_name: text(value.display_name) ?? '',
    is_personal: value.is_personal === true,
    is_deleted: value.is_deleted === true,
    tenant_handle: text(value.tenant_handle) ?? null,
    data_plane_url: text(value.data_plane_url) ?? null,
    // 裁剪后的字段是稳定契约,`raw` 是逃生阀:上游加了新字段也不必等我们改代码。
    raw: value,
  }
}

function normalizeProject(value: Json): Json {
  return {
    id: String(value.id ?? ''),
    tenant_id: String(value.tenant_id ?? ''),
    name: text(value.name) ?? null,
    description: text(value.description) ?? null,
    start_time: text(value.start_time) ?? null,
    end_time: text(value.end_time) ?? null,
    run_count: int(value.run_count) ?? null,
    error_rate: num(value.error_rate) ?? null,
    default_dataset_id: text(value.default_dataset_id) ?? null,
    reference_dataset_id: text(value.reference_dataset_id) ?? null,
    raw: value,
  }
}

/** `null` 与"不是对象"都归 `null`:出参声明里这几个字段是 nullable 而非 optional。 */
function nullableObject(value: unknown): Json | null {
  if (value === null || value === undefined) return null
  return record(value) ?? {}
}

function normalizeDataset(value: Json): Json {
  return {
    id: String(value.id ?? ''),
    tenant_id: String(value.tenant_id ?? ''),
    name: text(value.name) ?? '',
    description: text(value.description) ?? null,
    data_type: text(value.data_type) ?? null,
    created_at: text(value.created_at) ?? null,
    modified_at: text(value.modified_at) ?? null,
    example_count: int(value.example_count) ?? null,
    session_count: int(value.session_count) ?? null,
    metadata: nullableObject(value.metadata),
    raw: value,
  }
}

function normalizeExample(value: Json): Json {
  return {
    id: String(value.id ?? ''),
    dataset_id: String(value.dataset_id ?? ''),
    name: text(value.name) ?? null,
    created_at: text(value.created_at) ?? null,
    modified_at: text(value.modified_at) ?? null,
    inputs: record(value.inputs) ?? {},
    outputs: nullableObject(value.outputs),
    metadata: nullableObject(value.metadata),
    raw: value,
  }
}

export async function listWorkspaces(
  input: z.infer<typeof listWorkspacesInput>,
  ctx: ProviderContext,
): Promise<Json> {
  const payload = await request(ctx, {
    path: WORKSPACES_PATH,
    query: compact({ include_deleted: input.include_deleted, data_plane_id: text(input.data_plane_id) }),
  })
  return { workspaces: ensureObjectArray(payload, 'LangSmith workspace list').map(normalizeWorkspace) }
}

export async function listProjects(input: z.infer<typeof listProjectsInput>, ctx: ProviderContext): Promise<Json> {
  const payload = await request(ctx, {
    path: '/api/v1/sessions',
    query: compact({
      name: text(input.name),
      name_contains: text(input.name_contains),
      include_stats: input.include_stats,
      sort_by_desc: input.sort_by_desc,
      offset: input.offset,
      limit: input.limit,
    }),
  })
  return { projects: ensureObjectArray(payload, 'LangSmith project list').map(normalizeProject) }
}

export async function getProject(input: z.infer<typeof getProjectInput>, ctx: ProviderContext): Promise<Json> {
  const payload = await request(ctx, {
    path: `/api/v1/sessions/${requirePathId(input.projectId, 'projectId')}`,
    query: compact({ include_stats: input.include_stats }),
  })
  return { project: normalizeProject(ensureObject(payload, 'LangSmith project')) }
}

export async function createProject(input: z.infer<typeof createProjectInput>, ctx: ProviderContext): Promise<Json> {
  const payload = await request(ctx, {
    method: 'POST',
    path: '/api/v1/sessions',
    // upsert 是 query 参数而不是 body 字段 —— 放进 body 会被忽略,同名项目直接 409。
    query: compact({ upsert: input.upsert }),
    body: compact({
      name: text(input.name),
      description: text(input.description),
      start_time: text(input.start_time),
      end_time: text(input.end_time),
      extra: input.extra,
      default_dataset_id: text(input.default_dataset_id),
      reference_dataset_id: text(input.reference_dataset_id),
    }),
  })
  return { project: normalizeProject(ensureObject(payload, 'LangSmith created project')) }
}

export async function listDatasets(input: z.infer<typeof listDatasetsInput>, ctx: ProviderContext): Promise<Json> {
  const payload = await request(ctx, {
    path: '/api/v1/datasets',
    query: compact({
      name: text(input.name),
      name_contains: text(input.name_contains),
      data_type: text(input.data_type),
      offset: input.offset,
      limit: input.limit,
    }),
  })
  return { datasets: ensureObjectArray(payload, 'LangSmith dataset list').map(normalizeDataset) }
}

export async function getDataset(input: z.infer<typeof getDatasetInput>, ctx: ProviderContext): Promise<Json> {
  const payload = await request(ctx, { path: `/api/v1/datasets/${requirePathId(input.datasetId, 'datasetId')}` })
  return { dataset: normalizeDataset(ensureObject(payload, 'LangSmith dataset')) }
}

export async function createDataset(input: z.infer<typeof createDatasetInput>, ctx: ProviderContext): Promise<Json> {
  const payload = await request(ctx, {
    method: 'POST',
    path: '/api/v1/datasets',
    body: compact({
      name: text(input.name),
      description: text(input.description),
      data_type: text(input.data_type),
      inputs_schema_definition: input.inputs_schema_definition,
      outputs_schema_definition: input.outputs_schema_definition,
      metadata: input.metadata,
      externally_managed: input.externally_managed,
    }),
  })
  return { dataset: normalizeDataset(ensureObject(payload, 'LangSmith created dataset')) }
}

export async function listExamples(input: z.infer<typeof listExamplesInput>, ctx: ProviderContext): Promise<Json> {
  const payload = await request(ctx, {
    path: '/api/v1/examples',
    query: compact({
      // 线上参数名是 `dataset`,不是入参里的 `datasetId`。
      dataset: text(input.datasetId),
      full_text_contains: input.full_text_contains,
      as_of: text(input.as_of),
      offset: input.offset,
      limit: input.limit,
    }),
  })
  return { examples: ensureObjectArray(payload, 'LangSmith example list').map(normalizeExample) }
}

export async function getExample(input: z.infer<typeof getExampleInput>, ctx: ProviderContext): Promise<Json> {
  const payload = await request(ctx, {
    path: `/api/v1/examples/${requirePathId(input.exampleId, 'exampleId')}`,
    query: compact({ dataset: text(input.datasetId), as_of: text(input.as_of) }),
  })
  return { example: normalizeExample(ensureObject(payload, 'LangSmith example')) }
}

export async function createExample(input: z.infer<typeof createExampleInput>, ctx: ProviderContext): Promise<Json> {
  const payload = await request(ctx, {
    method: 'POST',
    path: '/api/v1/examples',
    body: compact({
      // 建例子时又叫 `dataset_id`(与 list/get 的 `dataset` 不是一个名字)。
      dataset_id: text(input.datasetId),
      inputs: input.inputs,
      outputs: input.outputs,
      metadata: input.metadata,
      split: input.split,
      id: text(input.id),
      created_at: text(input.created_at),
    }),
  })
  return { example: normalizeExample(ensureObject(payload, 'LangSmith created example')) }
}
