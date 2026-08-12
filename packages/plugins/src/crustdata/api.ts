/**
 * Crustdata 的业务逻辑。
 *
 * 迁移自 open-connector `src/providers/crustdata/executors.ts`,语义等价、写法本地化:
 * 凭证从 `ctx.upstreamAuth` 取(平台经 authRef 注入,插件不自持),出站走 `guardedFetch`,
 * 错误抛 `TBError` 七码。
 *
 * Crustdata 的形状很统一:**所有 action 都是 POST + JSON body**,没有 query 参数;
 * 版本走 `x-api-version` 头。入参用 camelCase,上游 API 收 snake_case,故有一层键名映射。
 *
 * 与上游的一处偏离:上游 `createCrustdataError` 把 404 压成 400、把 403 压成 401。
 * 这里把原始状态原样交给 `upstreamError`,收敛各 provider 互不相同的错误口径。
 */

import type { z } from 'zod/v4'
import { TBError } from '@tool-bridge/plugin-sdk'
import type {
  autocompleteCompaniesInput,
  enrichCompaniesInput,
  identifyCompaniesInput,
  searchCompaniesInput,
} from './schema'
import { type ProviderContext, requireApiKey } from '../_runtime/plugin'
import { upstreamError } from '../_runtime/upstreamError'
import { guardedFetch } from '../_runtime/guardedFetch'

const SERVICE = 'crustdata'
const API_BASE = 'https://api.crustdata.com'
const API_VERSION = '2025-11-01'

type Json = Record<string, unknown>

function record(value: unknown): Json | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Json) : undefined
}

function text(value: unknown): string | undefined {
  return typeof value === 'string' && value !== '' ? value : undefined
}

/** 上游破契约的响应一律 502(unavailable),不是调用方的错。 */
function requireObject(value: unknown, label: string): Json {
  const body = record(value)
  if (body === undefined) throw upstreamError(502, `crustdata ${label} 必须是对象`)
  return body
}

/** 剥掉值为 undefined 的键;上游 `compactObject` 的等价物。 */
function compact(input: Json): Json {
  return Object.fromEntries(Object.entries(input).filter(([, value]) => value !== undefined))
}

async function request(ctx: ProviderContext, path: string, body: Json): Promise<unknown> {
  // 取凭证放在 try 外:它抛的是配置错误,不该被下面的传输失败兜底吞成 502。
  const apiKey = requireApiKey(ctx, SERVICE)

  let response: Response
  try {
    response = await guardedFetch(new URL(path, API_BASE).toString(), {
      method: 'POST',
      headers: {
        'authorization': `Bearer ${apiKey}`,
        'content-type': 'application/json',
        'x-api-version': API_VERSION,
      },
      body: JSON.stringify(body),
    })
  } catch (error) {
    // 传输层失败必须就地归一:漏出去的裸 Error 会被 plugin-sdk 抹成 "internal plugin error"
    // 500,把"上游不通/出网被拦"说成插件自身故障。
    throw upstreamError(502, error instanceof Error ? `crustdata 请求失败: ${error.message}` : 'crustdata 请求失败')
  }

  // Crustdata 的错误体有时是纯文本;解析不出 JSON 就把原文当 payload,留给消息提取。
  const raw = await response.text().catch(() => '')
  let payload: unknown = null
  if (raw.trim() !== '') {
    try {
      payload = JSON.parse(raw) as unknown
    } catch {
      payload = raw
    }
  }

  if (!response.ok) {
    const body_ = record(payload)
    const message = text(body_?.reason) ?? text(body_?.error) ?? text(body_?.message)
      ?? (typeof payload === 'string' && payload.trim() !== '' ? payload.trim() : `crustdata 请求失败,状态 ${response.status}`)
    throw upstreamError(response.status, message)
  }
  return payload
}

/**
 * identify / enrich 的响应是**裸数组**,每项一个提交的标识符。整形成 camelCase,
 * 顺便把上游破契约的形状挡在这一层。
 */
function normalizeResults(payload: unknown): Json[] {
  if (!Array.isArray(payload)) throw upstreamError(502, 'crustdata 响应必须是数组')
  return payload.map((item) => {
    const result = requireObject(item, 'result')
    if (!Array.isArray(result.matches)) throw upstreamError(502, 'crustdata matches 必须是数组')
    const matchedOn = result.matched_on
    if (typeof matchedOn !== 'string' && typeof matchedOn !== 'number' && typeof matchedOn !== 'boolean') {
      throw upstreamError(502, 'crustdata matched_on 必须是可转字符串的值')
    }
    const matchType = text(result.match_type)
    if (matchType === undefined) throw upstreamError(502, 'crustdata match_type 必须是非空字符串')
    return {
      matchedOn: String(matchedOn),
      matchType,
      matches: result.matches.map((item_) => {
        const match = requireObject(item_, 'match')
        if (typeof match.confidence_score !== 'number') {
          throw upstreamError(502, 'crustdata confidence_score 必须是数字')
        }
        return {
          confidenceScore: match.confidence_score,
          companyData: requireObject(match.company_data, 'company_data'),
        }
      }),
    }
  })
}

/**
 * 四个标识符数组**恰好给一个**:这是跨字段约束,schema 表达不了。
 * 给多个时 Crustdata 静默只认其中一个,本地挡下比拿到莫名其妙的结果强。
 */
function identifierBody(input: z.infer<typeof identifyCompaniesInput>): Json {
  const present = ([
    input.domains,
    input.professionalNetworkProfileUrls,
    input.names,
    input.crustdataCompanyIds,
  ] as const).filter(value => value !== undefined)
  if (present.length !== 1) {
    throw new TBError('invalid_argument', '必须且只能提供一个标识符数组(domains / professionalNetworkProfileUrls / names / crustdataCompanyIds)')
  }
  return compact({
    domains: input.domains,
    professional_network_profile_urls: input.professionalNetworkProfileUrls,
    names: input.names,
    crustdata_company_ids: input.crustdataCompanyIds,
    fields: input.fields,
    exact_match: input.exactMatch,
  })
}

export async function identifyCompanies(
  input: z.infer<typeof identifyCompaniesInput>,
  ctx: ProviderContext,
): Promise<Json> {
  return { results: normalizeResults(await request(ctx, '/company/identify', identifierBody(input))) }
}

export async function enrichCompanies(
  input: z.infer<typeof enrichCompaniesInput>,
  ctx: ProviderContext,
): Promise<Json> {
  return { results: normalizeResults(await request(ctx, '/company/enrich', identifierBody(input))) }
}

export async function searchCompanies(
  input: z.infer<typeof searchCompaniesInput>,
  ctx: ProviderContext,
): Promise<Json> {
  const payload = await request(ctx, '/company/search', compact({
    filters: input.filters,
    fields: input.fields,
    sorts: input.sorts,
    limit: input.limit,
    cursor: input.cursor,
  }))
  const response = requireObject(payload, 'search response')
  if (!Array.isArray(response.companies)) throw upstreamError(502, 'crustdata companies 必须是数组')
  // `null` 与"缺失"在这里同义:出参 schema 把两个游标字段声明成 nullable 而非 optional,
  // 缺失时必须显式回 null,不能省略键。
  const cursor = response.next_cursor
  const total = response.total_count
  if (cursor !== undefined && cursor !== null && text(cursor) === undefined) {
    throw upstreamError(502, 'crustdata next_cursor 必须是非空字符串或 null')
  }
  if (total !== undefined && total !== null && !Number.isInteger(total)) {
    throw upstreamError(502, 'crustdata total_count 必须是整数或 null')
  }
  return {
    companies: response.companies.map(company => requireObject(company, 'company')),
    nextCursor: cursor === undefined || cursor === null ? null : (cursor as string),
    totalCount: total === undefined || total === null ? null : (total as number),
  }
}

export async function autocompleteCompanies(
  input: z.infer<typeof autocompleteCompaniesInput>,
  ctx: ProviderContext,
): Promise<Json> {
  const payload = await request(ctx, '/company/search/autocomplete', compact({
    field: input.field,
    // `query` 空串是有意义的输入("给我该字段的常见值"),不能按"缺失"剥掉。
    query: input.query,
    limit: input.limit,
    filters: input.filters,
  }))
  const response = requireObject(payload, 'autocomplete response')
  if (!Array.isArray(response.suggestions)) throw upstreamError(502, 'crustdata suggestions 必须是数组')
  return {
    suggestions: response.suggestions.map((item) => {
      const value = text(requireObject(item, 'suggestion').value)
      if (value === undefined) throw upstreamError(502, 'crustdata suggestion.value 必须是非空字符串')
      return { value }
    }),
  }
}
