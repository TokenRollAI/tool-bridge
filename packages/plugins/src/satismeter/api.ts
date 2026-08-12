/**
 * SatisMeter 的业务逻辑。
 *
 * 迁移自 open-connector `src/providers/satismeter/executors.ts`,语义等价、写法本地化:
 * 凭证从 `ctx.upstreamAuth` 取,出站走 `guardedFetch`,错误抛 `TBError` 七码。
 *
 * SatisMeter 的响应统一是 `{data, page?}` 信封,各 action 只是把 `data` 换个名字透出;
 * 错误文案在 `errors[0].title`。上游那套「404 压成 400、5xx 压成 502、validate 阶段
 * 把 401 压成 400」的自有映射没有搬:状态码归一现在统一走 `upstreamError`,
 * 「project 不存在」因此落在 not_found 而不是 invalid_argument。
 */

import type { z } from 'zod/v4'
import { TBError } from '@tool-bridge/plugin-sdk'
import type {
  getProjectInput,
  getSurveyInput,
  getSurveyStatisticsInput,
  listProjectResponsesInput,
  listSurveyResponsesInput,
  listSurveysInput,
} from './schema'
import { type ProviderContext, requireApiKey } from '../_runtime/plugin'
import { upstreamError } from '../_runtime/upstreamError'
import { guardedFetch } from '../_runtime/guardedFetch'

const SERVICE = 'satismeter'
const API_BASE = 'https://app.satismeter.com/api/v3'

type Json = Record<string, unknown>

function asRecord(value: unknown): Json | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Json)
    : undefined
}

/**
 * 生成的 schema 把前三个 action 的 projectId / campaignId 标成了 optional(上游 action
 * 定义如此),但上游 handler 一律 `requiredString(...)`。在本地挡住,免得拼出
 * `/projects/undefined` 打一次必然失败的往返。
 */
function requiredId(value: string | undefined, field: string): string {
  if (value === undefined || value === '') {
    throw new TBError('invalid_argument', `${field} 不能为空`)
  }
  return encodeURIComponent(value)
}

/** SatisMeter 的错误文案在 `errors[0].title`。 */
function errorMessage(payload: unknown, response: Response): string {
  const errors = asRecord(payload)?.errors
  if (Array.isArray(errors)) {
    const title = asRecord(errors[0])?.title
    if (typeof title === 'string' && title !== '') return title
  }
  return response.statusText || `satismeter request failed with status ${response.status}`
}

/** 错误响应上的 body 解析失败不算额外的错(上游会回 HTML 或空体),成功响应上才算。 */
async function readPayload(response: Response): Promise<unknown> {
  const text = await response.text()
  if (text === '') return null
  try {
    return JSON.parse(text) as unknown
  } catch {
    if (!response.ok) return null
    throw new TBError('unavailable', 'SatisMeter 返回了非 JSON 响应', { retryable: true })
  }
}

async function request(
  ctx: ProviderContext,
  path: string,
  query: Record<string, number | string | undefined> = {},
): Promise<Json> {
  const url = new URL(path.startsWith('/') ? path.slice(1) : path, `${API_BASE}/`)
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined) url.searchParams.set(key, String(value))
  }

  let response: Response
  let payload: unknown
  try {
    response = await guardedFetch(url.toString(), {
      method: 'GET',
      headers: { accept: 'application/json', authorization: `Bearer ${requireApiKey(ctx, SERVICE)}` },
    })
    payload = await readPayload(response)
  } catch (error) {
    if (error instanceof TBError) throw error
    throw new TBError(
      'unavailable',
      error instanceof Error ? `SatisMeter 请求失败: ${error.message}` : 'SatisMeter 请求失败',
      { retryable: true },
    )
  }

  if (!response.ok) throw upstreamError(response.status, errorMessage(payload, response))
  const body = asRecord(payload)
  if (body === undefined) {
    throw new TBError('unavailable', 'SatisMeter 返回了非对象响应', { retryable: true })
  }
  return body
}

/** 信封字段的契约:说好是对象/数组,不是就是上游出问题,不是调用方的错。 */
function requireObject(value: unknown, field: string): Json {
  const record = asRecord(value)
  if (record === undefined) {
    throw new TBError('unavailable', `SatisMeter 响应的 ${field} 不是对象`, { retryable: true })
  }
  return record
}

function requireArray(value: unknown, field: string): Json[] {
  if (!Array.isArray(value)) {
    throw new TBError('unavailable', `SatisMeter 响应的 ${field} 不是数组`, { retryable: true })
  }
  return value.map(item => requireObject(item, `${field}[]`))
}

/** 两个 responses action 共用的时间窗 + cursor 分页参数。 */
function responsesQuery(input: {
  endDate?: string
  pageCursor?: string
  pageSize?: number
  startDate?: string
}): Record<string, number | string | undefined> {
  return {
    startDate: input.startDate,
    endDate: input.endDate,
    pageCursor: input.pageCursor,
    pageSize: input.pageSize,
  }
}

export async function getProject(
  input: z.infer<typeof getProjectInput>,
  ctx: ProviderContext,
): Promise<Json> {
  const body = await request(ctx, `/projects/${requiredId(input.projectId, 'projectId')}`)
  return { project: requireObject(body.data, 'data') }
}

export async function listSurveys(
  input: z.infer<typeof listSurveysInput>,
  ctx: ProviderContext,
): Promise<Json> {
  const body = await request(ctx, `/projects/${requiredId(input.projectId, 'projectId')}/campaigns`)
  return { surveys: requireArray(body.data, 'data') }
}

export async function getSurvey(
  input: z.infer<typeof getSurveyInput>,
  ctx: ProviderContext,
): Promise<Json> {
  const path = `/projects/${requiredId(input.projectId, 'projectId')}`
    + `/campaigns/${requiredId(input.campaignId, 'campaignId')}`
  const body = await request(ctx, path)
  return { survey: requireObject(body.data, 'data') }
}

export async function listProjectResponses(
  input: z.infer<typeof listProjectResponsesInput>,
  ctx: ProviderContext,
): Promise<Json> {
  const path = `/projects/${encodeURIComponent(input.projectId)}/responses`
  const body = await request(ctx, path, responsesQuery(input))
  return { responses: requireArray(body.data, 'data'), page: requireObject(body.page, 'page') }
}

export async function listSurveyResponses(
  input: z.infer<typeof listSurveyResponsesInput>,
  ctx: ProviderContext,
): Promise<Json> {
  const path = `/projects/${encodeURIComponent(input.projectId)}`
    + `/campaigns/${encodeURIComponent(input.campaignId)}/responses`
  const body = await request(ctx, path, responsesQuery(input))
  return { responses: requireArray(body.data, 'data'), page: requireObject(body.page, 'page') }
}

export async function getSurveyStatistics(
  input: z.infer<typeof getSurveyStatisticsInput>,
  ctx: ProviderContext,
): Promise<Json> {
  const path = `/projects/${encodeURIComponent(input.projectId)}`
    + `/campaigns/${encodeURIComponent(input.campaignId)}/statistics`
  const body = await request(ctx, path, { startDate: input.startDate, endDate: input.endDate })
  return { statistics: requireObject(body.data, 'data') }
}
