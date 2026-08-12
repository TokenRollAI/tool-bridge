/**
 * Pinecone 的业务逻辑。
 *
 * 迁移自 open-connector `src/providers/pinecone/runtime.ts`,语义等价、写法本地化:
 * 凭证从 `ctx.upstreamAuth` 取(平台经 authRef 注入,插件不自持),出站走 `guardedFetch`,
 * 错误抛 `TBError` 七码。
 *
 * 凭证走 **header**(`api-key`),不进 URL。
 *
 * 四处上游细节决定了这里的形状:
 * - Pinecone 分**控制面**与**数据面**两套 base URL。控制面固定在 `api.pinecone.io`;
 *   数据面的 host 由**调用方按 index 传入**(`indexHost`),故它是一个租户可控的出站目标
 *   —— `requireIndexHost()` 强制 https、拒带内嵌凭证的 URL、剥掉 path/query/hash,
 *   再叠上 `guardedFetch` 的逐跳私网校验。这两层缺一不可。
 * - 每个请求都要带 `x-pinecone-api-version`,它决定响应形状,不是可选优化项。
 * - 上游对响应体的解析在**判 ok 之前**:非 JSON 体一律 502「invalid JSON」,即便它其实是
 *   一个 4xx 的 HTML 错误页。这条保留 —— Pinecone 的错误体是稳定 JSON,回 HTML 说明
 *   请求根本没到 Pinecone。
 * - 三个 action(query / delete_vectors / update_vector)有 schema 表达不了的"多选一"约束,
 *   断言留在这层;`describe_index` 等的 `name` 在上游 schema 里也没标 required,同样保留断言。
 *
 * 与上游的有意偏离:
 * - 上游 `createPineconeError` 把 404 之外的 4xx 全压成 400、把 5xx 压成 502。这里把原始
 *   状态交给 `upstreamError`(404 → not_found、409 → conflict、429 → rate_limited),
 *   收敛各 provider 互不相同的错误口径正是 `_runtime/upstreamError.ts` 存在的理由。
 *   顺带消掉了上游 `notFoundAsInvalidInput` 那个开关 —— 有它没它 404 都是 not_found。
 * - 上游的 `phase: 'validate'` 分支只服务 `validatePineconeCredential`。平台侧的
 *   credentialProbe 自己做这层分账,故不迁。
 * - 不发 `user-agent`:上游那个值标识的是 open-connector 进程,在这里已无意义。
 */

import type { z } from 'zod/v4'
import { TBError } from '@tool-bridge/plugin-sdk'
import type {
  configureIndexInput,
  createIndexInput,
  deleteIndexInput,
  deleteVectorsInput,
  describeIndexInput,
  fetchVectorsInput,
  getIndexStatsInput,
  listIndexesInput,
  listVectorIdsInput,
  queryVectorsInput,
  updateVectorInput,
  upsertVectorsInput,
} from './schema'
import { type ProviderContext, requireApiKey } from '../_runtime/plugin'
import { upstreamError } from '../_runtime/upstreamError'
import { guardedFetch } from '../_runtime/guardedFetch'

const SERVICE = 'pinecone'
const CONTROL_API_BASE = 'https://api.pinecone.io'
/** 响应形状按它协商,值变了就是换了一套契约。 */
const API_VERSION = '2026-04'

type Json = Record<string, unknown>
type QueryValue = string | string[] | undefined

function record(value: unknown): Json | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Json) : undefined
}

/** 上游 `optionalString` 的等价物:去空白后仍非空才算有值。 */
function text(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  return trimmed === '' ? undefined : trimmed
}

/** 上游 `requiredString`:schema 没标 required 的字段,必填断言落在这里。 */
function requireText(value: unknown, field: string): string {
  const result = text(value)
  if (result === undefined) throw new TBError('invalid_argument', `${field} is required.`)
  return result
}

/** 上游 `compactObject`:丢掉值为 undefined 的键。 */
function compact(input: Json): Json {
  return Object.fromEntries(Object.entries(input).filter(([, value]) => value !== undefined))
}

/** 上游 `compactJson`:逐层丢掉 undefined;数组下标有语义,原样保留。 */
function compactDeep(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(item => compactDeep(item))
  const fields = record(value)
  if (fields === undefined) return value
  return Object.fromEntries(
    Object.entries(fields)
      .filter(([, child]) => child !== undefined)
      .map(([key, child]) => [key, compactDeep(child)]),
  )
}

/**
 * 数据面的 base URL 由调用方给,它是本 provider 唯一的租户可控出站目标。
 * 强制 https(明文会把 api-key 送上网)、拒绝内嵌凭证的 URL(`https://u:p@host` 会让
 * 凭证进日志),并剥掉 path/query/hash 免得调用方拿它拼出别的端点。
 */
function requireIndexHost(value: unknown): string {
  const host = requireText(value, 'indexHost')
  let parsed: URL
  try {
    parsed = new URL(host)
  } catch {
    throw new TBError('invalid_argument', 'indexHost must be a valid absolute URL')
  }
  if (parsed.protocol !== 'https:') throw new TBError('invalid_argument', 'indexHost must use https')
  if (parsed.username !== '' || parsed.password !== '') {
    throw new TBError('invalid_argument', 'indexHost must not include credentials')
  }
  parsed.pathname = parsed.pathname.replace(/\/+$/, '')
  parsed.search = ''
  parsed.hash = ''
  return parsed.toString().replace(/\/+$/, '')
}

function buildUrl(baseUrl: string, path: string, query: Record<string, QueryValue> | undefined): string {
  const url = new URL(path, `${baseUrl.replace(/\/+$/, '')}/`)
  for (const [key, value] of Object.entries(query ?? {})) {
    if (value === undefined) continue
    if (Array.isArray(value)) {
      // ids 靠重复同名参数表达,不能拼成一个逗号串。
      for (const item of value) url.searchParams.append(key, item)
      continue
    }
    url.searchParams.set(key, value)
  }
  return url.toString()
}

function headers(apiKey: string, hasBody: boolean): Record<string, string> {
  return {
    'accept': 'application/json',
    'api-key': apiKey,
    'x-pinecone-api-version': API_VERSION,
    ...(hasBody ? { 'content-type': 'application/json' } : {}),
  }
}

function errorMessage(payload: unknown, status: number): string {
  if (typeof payload === 'string') {
    const message = text(payload)
    if (message !== undefined) return message
  }
  const fields = record(payload)
  const message = text(fields?.message) ?? text(record(fields?.error)?.message)
  return message ?? `Pinecone request failed with status ${status}`
}

interface RequestInput {
  /** 缺省走控制面;数据面由 `indexHost` 决定。 */
  baseUrl?: string
  body?: Json
  method: 'DELETE' | 'GET' | 'PATCH' | 'POST'
  path: string
  query?: Record<string, QueryValue>
}

async function request(ctx: ProviderContext, input: RequestInput): Promise<unknown> {
  // 取凭证放在 try 外:它抛的是配置错误,不该被下面的传输失败兜底吞成 502。
  const apiKey = requireApiKey(ctx, SERVICE)

  let response: Response
  try {
    response = await guardedFetch(buildUrl(input.baseUrl ?? CONTROL_API_BASE, input.path, input.query), {
      method: input.method,
      headers: headers(apiKey, input.body !== undefined),
      body: input.body === undefined ? undefined : JSON.stringify(compactDeep(input.body)),
    })
  } catch (error) {
    // 传输层失败必须就地归一:漏出去的裸 Error 会被 plugin-sdk 抹成 "internal plugin error"
    // 500。EgressBlockedError 本身是 TBError(invalid_argument),原样冒上去。
    if (error instanceof TBError) throw error
    const message = error instanceof Error ? `Pinecone request failed: ${error.message}` : 'Pinecone request failed'
    throw upstreamError(502, message)
  }

  const raw = await response.text().catch(() => '')
  let payload: unknown = {}
  if (raw.trim() !== '') {
    try {
      payload = JSON.parse(raw)
    } catch {
      // 判 ok 之前就拦:Pinecone 的错误体是稳定 JSON,回非 JSON 说明请求压根没到 Pinecone。
      throw upstreamError(502, 'Pinecone returned invalid JSON')
    }
  }
  if (!response.ok) throw upstreamError(response.status, errorMessage(payload, response.status))
  return payload
}

/** 契约说好是 JSON 对象;不是就是上游出问题,不是调用方的错。 */
function requireObject(payload: unknown, label: string): Json {
  const fields = record(payload)
  if (fields === undefined) throw upstreamError(502, `${label} must be a JSON object`)
  return fields
}

function objectArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}

function dataRequest(
  ctx: ProviderContext,
  indexHost: unknown,
  input: Omit<RequestInput, 'baseUrl'>,
): Promise<unknown> {
  return request(ctx, { ...input, baseUrl: requireIndexHost(indexHost) })
}

export async function listIndexes(
  _input: z.infer<typeof listIndexesInput>,
  ctx: ProviderContext,
): Promise<Json> {
  const payload = requireObject(
    await request(ctx, { method: 'GET', path: '/indexes' }),
    'Pinecone indexes response',
  )
  return { indexes: objectArray(payload.indexes) }
}

export async function describeIndex(
  input: z.infer<typeof describeIndexInput>,
  ctx: ProviderContext,
): Promise<Json> {
  const payload = await request(ctx, {
    method: 'GET',
    path: `/indexes/${encodeURIComponent(requireText(input.name, 'name'))}`,
  })
  return { index: requireObject(payload, 'Pinecone index response') }
}

export async function createIndex(
  input: z.infer<typeof createIndexInput>,
  ctx: ProviderContext,
): Promise<Json> {
  const payload = await request(ctx, {
    method: 'POST',
    path: '/indexes',
    // camelCase 入参 → snake_case 请求体,且 spec 恒存在(只支持 serverless)。
    body: compact({
      name: requireText(input.name, 'name'),
      dimension: typeof input.dimension === 'number' ? input.dimension : undefined,
      metric: text(input.metric),
      vector_type: text(input.vectorType),
      deletion_protection: text(input.deletionProtection),
      tags: record(input.tags),
      spec: {
        serverless: {
          cloud: requireText(input.cloud, 'cloud'),
          region: requireText(input.region, 'region'),
        },
      },
    }),
  })
  return { index: requireObject(payload, 'Pinecone create index response') }
}

export async function configureIndex(
  input: z.infer<typeof configureIndexInput>,
  ctx: ProviderContext,
): Promise<Json> {
  const payload = await request(ctx, {
    method: 'PATCH',
    path: `/indexes/${encodeURIComponent(requireText(input.name, 'name'))}`,
    body: compact({
      deletion_protection: text(input.deletionProtection),
      tags: record(input.tags),
      // 没给 readCapacity 就整个不发 spec:发一个空 spec 会被 Pinecone 当成"改成空配置"。
      spec: input.readCapacity ? { serverless: { read_capacity: record(input.readCapacity) } } : undefined,
    }),
  })
  return { index: requireObject(payload, 'Pinecone configure index response') }
}

export async function deleteIndex(
  input: z.infer<typeof deleteIndexInput>,
  ctx: ProviderContext,
): Promise<Json> {
  await request(ctx, {
    method: 'DELETE',
    path: `/indexes/${encodeURIComponent(requireText(input.name, 'name'))}`,
  })
  return { accepted: true }
}

export async function getIndexStats(
  input: z.infer<typeof getIndexStatsInput>,
  ctx: ProviderContext,
): Promise<Json> {
  const payload = await dataRequest(ctx, input.indexHost, {
    method: 'POST',
    path: '/describe_index_stats',
    body: { filter: record(input.filter) },
  })
  return { stats: requireObject(payload, 'Pinecone index stats response') }
}

export async function upsertVectors(
  input: z.infer<typeof upsertVectorsInput>,
  ctx: ProviderContext,
): Promise<Json> {
  const payload = requireObject(
    await dataRequest(ctx, input.indexHost, {
      method: 'POST',
      path: '/vectors/upsert',
      body: { vectors: input.vectors, namespace: text(input.namespace) },
    }),
    'Pinecone upsert response',
  )
  return {
    upsertedCount: typeof payload.upsertedCount === 'number' ? payload.upsertedCount : 0,
    raw: payload,
  }
}

export async function queryVectors(
  input: z.infer<typeof queryVectorsInput>,
  ctx: ProviderContext,
): Promise<Json> {
  // 三选一:schema 只能各自标 optional,故留在这里判。
  if (!input.values && !input.sparseValues && !input.id) {
    throw new TBError('invalid_argument', 'query_vectors requires values, sparseValues, or id')
  }

  const payload = requireObject(
    await dataRequest(ctx, input.indexHost, {
      method: 'POST',
      path: '/query',
      // 入参名与线上字段名不同:values → vector、sparseValues → sparseVector。
      body: {
        vector: input.values,
        sparseVector: input.sparseValues,
        id: text(input.id),
        topK: input.topK,
        namespace: text(input.namespace),
        filter: record(input.filter),
        includeValues: input.includeValues,
        includeMetadata: input.includeMetadata,
      },
    }),
    'Pinecone query response',
  )
  return {
    matches: objectArray(payload.matches),
    // null 与"字段缺席"是两回事:前者是上游明确说"这次没有 namespace"。
    namespace: text(payload.namespace) ?? null,
    usage: record(payload.usage) ?? null,
    raw: payload,
  }
}

export async function fetchVectors(
  input: z.infer<typeof fetchVectorsInput>,
  ctx: ProviderContext,
): Promise<Json> {
  const payload = requireObject(
    await dataRequest(ctx, input.indexHost, {
      method: 'GET',
      path: '/vectors/fetch',
      // fetch 是 GET:ids 展开成重复的同名 query 参数,不进请求体。
      query: {
        namespace: text(input.namespace),
        ids: Array.isArray(input.ids) ? input.ids.map(id => String(id)) : [],
      },
    }),
    'Pinecone fetch response',
  )
  return {
    vectors: record(payload.vectors) ?? {},
    namespace: text(payload.namespace) ?? null,
    usage: record(payload.usage) ?? null,
    raw: payload,
  }
}

export async function listVectorIds(
  input: z.infer<typeof listVectorIdsInput>,
  ctx: ProviderContext,
): Promise<Json> {
  const payload = requireObject(
    await dataRequest(ctx, input.indexHost, {
      method: 'GET',
      path: '/vectors/list',
      query: {
        namespace: text(input.namespace),
        prefix: text(input.prefix),
        limit: input.limit === undefined ? undefined : String(input.limit),
        paginationToken: text(input.paginationToken),
      },
    }),
    'Pinecone list vectors response',
  )
  return {
    vectors: objectArray(payload.vectors),
    // 翻页靠它:上游没有下一页时给 null,把它压成 undefined 会让调用方分不清"到底了"。
    pagination: record(payload.pagination) ?? null,
    raw: payload,
  }
}

export async function deleteVectors(
  input: z.infer<typeof deleteVectorsInput>,
  ctx: ProviderContext,
): Promise<Json> {
  // 三选一:少了这道断言,一个空请求会把整个 namespace 删空。
  if (!input.ids && !input.filter && input.deleteAll !== true) {
    throw new TBError('invalid_argument', 'delete_vectors requires ids, filter, or deleteAll')
  }

  const payload = await dataRequest(ctx, input.indexHost, {
    method: 'POST',
    path: '/vectors/delete',
    body: {
      ids: input.ids,
      namespace: text(input.namespace),
      filter: record(input.filter),
      deleteAll: input.deleteAll,
    },
  })
  return { raw: requireObject(payload, 'Pinecone delete vectors response') }
}

export async function updateVector(
  input: z.infer<typeof updateVectorInput>,
  ctx: ProviderContext,
): Promise<Json> {
  // 二选一:schema 只能各自标 optional,故留在这里判。
  if (!input.id && !input.filter) {
    throw new TBError('invalid_argument', 'update_vector requires id or filter')
  }

  const payload = requireObject(
    await dataRequest(ctx, input.indexHost, {
      method: 'POST',
      path: '/vectors/update',
      body: {
        id: text(input.id),
        values: input.values,
        sparseValues: input.sparseValues,
        setMetadata: record(input.setMetadata),
        namespace: text(input.namespace),
        filter: record(input.filter),
        dryRun: input.dryRun,
      },
    }),
    'Pinecone update vector response',
  )
  return {
    matchedRecords: typeof payload.matchedRecords === 'number' ? payload.matchedRecords : null,
    raw: payload,
  }
}
