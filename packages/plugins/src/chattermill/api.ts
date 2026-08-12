/**
 * Chattermill 的业务逻辑。
 *
 * 迁移自 open-connector `src/providers/chattermill/executors.ts`,语义等价、写法本地化:
 * 凭证从 `ctx.upstreamAuth` 取(平台经 authRef 注入,插件不自持),出站走 `guardedFetch`,
 * 错误抛 `TBError` 七码。
 *
 * Chattermill 的形状很规整:22 个 action 里有 12 个是**同一对模板**(某个资源族的
 * list/get),差别只有路径段与结果键名,故收进 `FAMILIES` 表 + `listFamily`/`getFamily`
 * 两个函数,而不是抄十二遍。
 *
 * 每个 action 都额外透出 `raw`(上游原始响应):Chattermill 的字段随账户配置变化很大,
 * normalize 只取得出确定的那层,其余交给调用方从 raw 里挖。
 */

import type { z } from 'zod/v4'
import { TBError } from '@tool-bridge/plugin-sdk'
import type {
  createResponseInput,
  deleteResponseInput,
  getAttributeInput,
  getCategoryInput,
  getDataSourceInput,
  getDataTypeInput,
  getMetricInput,
  getProjectInput,
  getResponseInput,
  getTagInput,
  getThemeInput,
  listAttributesInput,
  listCategoriesInput,
  listCustomSegmentsInput,
  listDataSourcesInput,
  listDataTypesInput,
  listProjectsInput,
  listResponsesInput,
  listTagsInput,
  listThemesInput,
  searchResponsesInput,
  updateResponseInput,
} from './schema'
import { type ProviderContext, requireApiKey } from '../_runtime/plugin'
import { upstreamError } from '../_runtime/upstreamError'
import { guardedFetch } from '../_runtime/guardedFetch'

const SERVICE = 'chattermill'
const API_BASE = 'https://api.chattermill.com/v1'

type Json = Record<string, unknown>

/**
 * 资源族模板:`[路径段, 结果键, 单条结果键]`。
 * 路径段与结果键并不总是一致(`data_sources` → `dataSources`),故三个都写出来。
 */
const FAMILIES = {
  attribute: ['attributes', 'attributes', 'attribute'],
  category: ['categories', 'categories', 'category'],
  dataSource: ['data_sources', 'dataSources', 'dataSource'],
  dataType: ['data_types', 'dataTypes', 'dataType'],
  tag: ['tags', 'tags', 'tag'],
  theme: ['themes', 'themes', 'theme'],
} as const satisfies Record<string, readonly [string, string, string]>

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

/**
 * 路径参数在几个 action 的 schema 里是 optional(生成器照搬了上游 action 定义),
 * 但拼进 URL 前必须非空,否则会打出 `/undefined/responses`。
 */
function requirePathSegment(value: unknown, field: string): string {
  const text = optionalText(value)
  if (text === undefined) throw new TBError('invalid_argument', `${field} 不能为空`)
  return encodeURIComponent(text)
}

/** 上游 `queryParams`:`undefined`/`null`/空串都不发,其余一律 String 化。 */
function appendQuery(url: URL, query: Json): void {
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null || value === '') continue
    url.searchParams.set(key, String(value))
  }
}

/** 上游 `compactJson`:递归丢掉值为 `undefined` 的键。 */
function compactJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(item => compactJson(item))
  const record = asRecord(value)
  if (record === undefined) return value
  return Object.fromEntries(
    Object.entries(record)
      .filter(([, child]) => child !== undefined)
      .map(([key, child]) => [key, compactJson(child)]),
  )
}

/**
 * 成功时非 JSON 算上游破契约(502);失败时非 JSON 就把原文当消息 ——
 * 错误页是 HTML 的情况下,那段 HTML 比"invalid JSON"有诊断价值。
 */
async function readPayload(response: Response): Promise<unknown> {
  const text = await response.text()
  if (text.trim() === '') return null
  try {
    return JSON.parse(text) as unknown
  } catch {
    if (!response.ok) return text
    throw upstreamError(502, 'Chattermill 返回了非法 JSON')
  }
}

interface RequestInput {
  body?: Json
  method?: 'DELETE' | 'GET' | 'POST' | 'PUT'
  query?: Json
}

async function request(ctx: ProviderContext, path: string, input: RequestInput = {}): Promise<unknown> {
  const apiKey = requireApiKey(ctx, SERVICE)
  const url = new URL(`${API_BASE}${path}`)
  appendQuery(url, input.query ?? {})

  const headers: Record<string, string> = {
    accept: 'application/json',
    authorization: `Bearer ${apiKey}`,
  }
  if (input.body !== undefined) headers['content-type'] = 'application/json'

  let response: Response
  let payload: unknown
  try {
    response = await guardedFetch(url.toString(), {
      method: input.method ?? 'GET',
      headers,
      ...(input.body === undefined ? {} : { body: JSON.stringify(compactJson(input.body)) }),
    })
    payload = await readPayload(response)
  } catch (error) {
    // 传输层失败必须就地归一:漏出去的裸 Error 会被 plugin-sdk 抹成 "internal plugin error"
    // 500,把"上游不通/出网被拦"说成插件自身故障,还丢掉唯一有诊断价值的那句消息。
    if (error instanceof TBError) throw error
    throw upstreamError(
      502,
      error instanceof Error ? `Chattermill 请求失败: ${error.message}` : 'Chattermill 请求失败',
    )
  }

  if (!response.ok) {
    const record = asRecord(payload)
    throw upstreamError(
      response.status,
      optionalText(record?.message)
      ?? optionalText(record?.error)
      ?? optionalText(payload)
      ?? (response.statusText || `Chattermill 请求失败(HTTP ${response.status})`),
    )
  }
  return payload
}

/** 上游对列表一律"取不到就当空列表",不报错 —— 保留:空结果不是故障。 */
function extractArray(payload: unknown, key: string): unknown[] {
  const value = asRecord(payload)?.[key]
  return Array.isArray(value) ? value : []
}

/** 单条资源:优先取信封里的同名键,取不到就把整个响应当那条资源。 */
function wrapSingle(payload: unknown, key: string): Json {
  return asRecord(asRecord(payload)?.[key]) ?? asRecord(payload) ?? {}
}

/** list/search responses 共用的过滤器:驼峰入参换成 Chattermill 的下划线线上名。 */
function responseQuery(input: Json): Json {
  return {
    page: input.page,
    per_page: input.perPage,
    from: input.from,
    to: input.to,
    data_type: input.dataType,
    data_source: input.dataSource,
    filter_property: input.filterProperty,
    filter_value: input.filterValue,
    text_analytics_processed: input.textAnalyticsProcessed,
    comment_present: input.commentPresent,
    score_from: input.scoreFrom,
    score_to: input.scoreTo,
    custom_segment_id: input.customSegmentId,
    theme_id: input.themeId,
    updated_from: input.updatedFrom,
    updated_to: input.updatedTo,
    response_id: input.responseId,
    user_meta_property: input.userMetaProperty,
    user_meta_value: input.userMetaValue,
  }
}

async function listFamily(
  input: { project?: string },
  ctx: ProviderContext,
  family: readonly [string, string, string],
): Promise<Json> {
  const raw = await request(ctx, `/${requirePathSegment(input.project, 'project')}/${family[0]}`)
  return { [family[1]]: extractArray(raw, family[0]), raw }
}

async function getFamily(
  input: { id?: string, project?: string },
  ctx: ProviderContext,
  family: readonly [string, string, string],
): Promise<Json> {
  const project = requirePathSegment(input.project, 'project')
  const id = requirePathSegment(input.id, 'id')
  const raw = await request(ctx, `/${project}/${family[0]}/${id}`)
  return { [family[2]]: wrapSingle(raw, family[2]), raw }
}

export async function listProjects(
  _input: z.infer<typeof listProjectsInput>,
  ctx: ProviderContext,
): Promise<Json> {
  const raw = await request(ctx, '/projects')
  return { projects: extractArray(raw, 'projects'), raw }
}

export async function getProject(
  input: z.infer<typeof getProjectInput>,
  ctx: ProviderContext,
): Promise<Json> {
  const raw = await request(ctx, `/projects/${requirePathSegment(input.id, 'id')}`)
  return { project: wrapSingle(raw, 'project'), raw }
}

export async function listResponses(
  input: z.infer<typeof listResponsesInput>,
  ctx: ProviderContext,
): Promise<Json> {
  const raw = await request(ctx, `/${requirePathSegment(input.project, 'project')}/responses`, {
    query: responseQuery(input),
  })
  return { responses: extractArray(raw, 'responses'), raw }
}

export async function getResponse(
  input: z.infer<typeof getResponseInput>,
  ctx: ProviderContext,
): Promise<Json> {
  const project = requirePathSegment(input.project, 'project')
  const id = requirePathSegment(input.id, 'id')
  const raw = await request(ctx, `/${project}/responses/${id}`)
  return { response: wrapSingle(raw, 'response'), raw }
}

export async function createResponse(
  input: z.infer<typeof createResponseInput>,
  ctx: ProviderContext,
): Promise<Json> {
  const raw = await request(ctx, `/${requirePathSegment(input.project, 'project')}/responses`, {
    method: 'POST',
    body: { response: input.response },
  })
  // 写入类 action 里 response 取不到时给 null(而非 `{}`):调用方要能分辨"上游没回内容"。
  return { response: asRecord(asRecord(raw)?.response) ?? null, raw }
}

export async function updateResponse(
  input: z.infer<typeof updateResponseInput>,
  ctx: ProviderContext,
): Promise<Json> {
  const project = requirePathSegment(input.project, 'project')
  const responseId = requirePathSegment(input.responseId, 'responseId')
  const raw = await request(ctx, `/${project}/responses/${responseId}`, {
    method: 'PUT',
    body: { response: input.response },
  })
  return { response: asRecord(asRecord(raw)?.response) ?? null, raw }
}

export async function deleteResponse(
  input: z.infer<typeof deleteResponseInput>,
  ctx: ProviderContext,
): Promise<Json> {
  const project = requirePathSegment(input.project, 'project')
  const responseId = requirePathSegment(input.responseId, 'responseId')
  const raw = await request(ctx, `/${project}/responses/${responseId}`, { method: 'DELETE' })
  // responseId 回的是**原始入参**,不是编码后的路径段。
  return { deleted: true, responseId: input.responseId, raw }
}

export async function searchResponses(
  input: z.infer<typeof searchResponsesInput>,
  ctx: ProviderContext,
): Promise<Json> {
  const raw = await request(ctx, `/${requirePathSegment(input.project, 'project')}/responses/search`, {
    query: responseQuery(input),
  })
  return { responses: extractArray(raw, 'responses'), raw }
}

export async function listDataSources(
  input: z.infer<typeof listDataSourcesInput>,
  ctx: ProviderContext,
): Promise<Json> {
  return listFamily(input, ctx, FAMILIES.dataSource)
}

export async function getDataSource(
  input: z.infer<typeof getDataSourceInput>,
  ctx: ProviderContext,
): Promise<Json> {
  return getFamily(input, ctx, FAMILIES.dataSource)
}

export async function listDataTypes(
  input: z.infer<typeof listDataTypesInput>,
  ctx: ProviderContext,
): Promise<Json> {
  return listFamily(input, ctx, FAMILIES.dataType)
}

export async function getDataType(
  input: z.infer<typeof getDataTypeInput>,
  ctx: ProviderContext,
): Promise<Json> {
  return getFamily(input, ctx, FAMILIES.dataType)
}

export async function listCustomSegments(
  input: z.infer<typeof listCustomSegmentsInput>,
  ctx: ProviderContext,
): Promise<Json> {
  const raw = await request(ctx, `/${requirePathSegment(input.project, 'project')}/custom_segments`)
  return { customSegments: extractArray(raw, 'custom_segments'), raw }
}

export async function getMetric(
  input: z.infer<typeof getMetricInput>,
  ctx: ProviderContext,
): Promise<Json> {
  const project = requirePathSegment(input.project, 'project')
  const type = requirePathSegment(input.type, 'type')
  // 上游把**整个入参**当 query 发(project/type 因此同时出现在路径与 query 里)。
  // 看着冗余,但 Chattermill 的 metric 端点确实接受一批不固定的过滤参数,
  // 而 schema 是 looseObject —— 白名单会把调用方多传的过滤器悄悄吃掉。
  const raw = await request(ctx, `/${project}/metrics/${type}`, { query: input })
  return { metric: raw, raw }
}

export async function listThemes(
  input: z.infer<typeof listThemesInput>,
  ctx: ProviderContext,
): Promise<Json> {
  return listFamily(input, ctx, FAMILIES.theme)
}

export async function getTheme(
  input: z.infer<typeof getThemeInput>,
  ctx: ProviderContext,
): Promise<Json> {
  return getFamily(input, ctx, FAMILIES.theme)
}

export async function listCategories(
  input: z.infer<typeof listCategoriesInput>,
  ctx: ProviderContext,
): Promise<Json> {
  return listFamily(input, ctx, FAMILIES.category)
}

export async function getCategory(
  input: z.infer<typeof getCategoryInput>,
  ctx: ProviderContext,
): Promise<Json> {
  return getFamily(input, ctx, FAMILIES.category)
}

export async function listAttributes(
  input: z.infer<typeof listAttributesInput>,
  ctx: ProviderContext,
): Promise<Json> {
  return listFamily(input, ctx, FAMILIES.attribute)
}

export async function getAttribute(
  input: z.infer<typeof getAttributeInput>,
  ctx: ProviderContext,
): Promise<Json> {
  return getFamily(input, ctx, FAMILIES.attribute)
}

export async function listTags(
  input: z.infer<typeof listTagsInput>,
  ctx: ProviderContext,
): Promise<Json> {
  return listFamily(input, ctx, FAMILIES.tag)
}

export async function getTag(
  input: z.infer<typeof getTagInput>,
  ctx: ProviderContext,
): Promise<Json> {
  return getFamily(input, ctx, FAMILIES.tag)
}
