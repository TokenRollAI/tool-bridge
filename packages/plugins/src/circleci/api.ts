/**
 * CircleCI 的业务逻辑。
 *
 * 迁移自 open-connector `src/providers/circleci/executors.ts`,语义等价、写法本地化:
 * 凭证从 `ctx.upstreamAuth` 取(平台经 authRef 注入,插件不自持),出站走 `guardedFetch`,
 * 错误抛 `TBError` 七码。
 *
 * 三处上游细节决定了这里的形状:
 * - 认证头是 `Circle-Token`,不是 Authorization。
 * - **projectSlug 整体是一个路径段**:`gh/acme/repo` 要 `encodeURIComponent` 成
 *   `gh%2Facme%2Frepo` 再拼进 URL。调用方常把 CircleCI 网页地址里的 `project/` 前缀或
 *   已编码的 `%2F` 一起粘过来,故先归一(剥前缀、解码、去首尾斜杠)再编码。
 * - 两个 job 端点的路径**不对称**:详情是 `/project/{slug}/job/{n}`,产物却是
 *   `/project/{slug}/{n}/artifacts`(没有 `job` 段)。这是 CircleCI API 本身的历史包袱,
 *   顺手"对齐"就 404。
 *
 * 与上游的两处有意偏离(都在错误归一上):
 * - 上游 `createCircleciError` 把 404 压成 400(`notFoundAsInvalidInput`)、把 403/409
 *   一类非 5xx 状态压成 502。这里把原始状态原样交给共用的 `upstreamError`:404 落
 *   not_found、403 落 permission_denied、409 落 conflict。压成 502 尤其危险 —— 那是
 *   可重试码,agent 会对"这个 token 没权限"反复重试。
 * - 上游对**错误响应**也要求正文是 JSON,不是就抛"response was not valid JSON"(502),
 *   于是一个回 HTML 错误页的 401 会呈现为上游故障。这里错误响应解析失败就按 HTTP 状态归一。
 */

import type { z } from 'zod/v4'
import { TBError } from '@tool-bridge/plugin-sdk'
import type {
  getJobArtifactsInput,
  getJobDetailsInput,
  getPipelineInput,
  getProjectInput,
  getWorkflowSummaryInput,
  listInsightsSummaryInput,
  listPipelinesForProjectInput,
  listProjectEnvVarsInput,
  listWorkflowsByPipelineInput,
  triggerPipelineInput,
} from './schema'
import { type ProviderContext, requireApiKey } from '../_runtime/plugin'
import { upstreamError } from '../_runtime/upstreamError'
import { guardedFetch } from '../_runtime/guardedFetch'

const SERVICE = 'circleci'
const API_BASE = 'https://circleci.com/api/v2'

type Json = Record<string, unknown>

interface RequestInput {
  body?: Json
  method?: 'GET' | 'POST'
  path: string
  query?: Record<string, string | undefined>
}

/** 上游 `optionalString` 的等价物:去空白后仍非空才算有值。 */
function text(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  return trimmed === '' ? undefined : trimmed
}

function record(value: unknown): Json | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Json) : undefined
}

function trimSlashes(value: string): string {
  let start = 0
  let end = value.length
  while (start < end && value[start] === '/') start += 1
  while (end > start && value[end - 1] === '/') end -= 1
  return value.slice(start, end)
}

/**
 * 把调用方给的 slug 归一成 CircleCI 认的形态。
 *
 * 三种常见的"粘过来的"写法都要接住:网页地址里的 `project/gh/acme/repo`、已经编码过的
 * `gh%2Facme%2Frepo`、以及带首尾斜杠的。归一后**整体**作为一个路径段编码。
 */
function normalizeSlug(rawValue: string, field: string, stripProjectPrefix: boolean): string {
  let value = rawValue.trim()
  if (stripProjectPrefix) {
    if (value.startsWith('/project/')) value = value.slice('/project/'.length)
    else if (value.startsWith('project/')) value = value.slice('project/'.length)
  }

  if (value.includes('%2F') || value.includes('%2f')) {
    try {
      value = decodeURIComponent(value)
    } catch {
      // 半截百分号编码(如 `%2`)会让 decodeURIComponent 抛,这是调用方拼错了。
      throw new TBError('invalid_argument', `${field} 不是合法的 slug`)
    }
  }

  value = trimSlashes(value)
  if (value === '') throw new TBError('invalid_argument', `${field} 不是合法的 slug`)
  return value
}

function projectSlug(value: string): string {
  return normalizeSlug(value, 'projectSlug', true)
}

function orgSlug(value: string): string {
  return normalizeSlug(value, 'orgSlug', false)
}

/** 错误消息:正文是纯串就用它,否则取 message、再退回 error。 */
function errorMessage(payload: unknown, status: number): string {
  if (typeof payload === 'string') {
    const trimmed = payload.trim()
    if (trimmed !== '') return trimmed
  }
  const body = record(payload)
  return text(body?.message) ?? text(body?.error) ?? `CircleCI 返回 HTTP ${status}`
}

function buildUrl(path: string, query: Record<string, string | undefined> | undefined): string {
  const url = new URL(`${API_BASE}${path}`)
  for (const [key, value] of Object.entries(query ?? {})) {
    if (value === undefined || value === '') continue
    url.searchParams.set(key, value)
  }
  return url.toString()
}

async function request(ctx: ProviderContext, input: RequestInput): Promise<unknown> {
  const headers: Record<string, string> = {
    'circle-token': requireApiKey(ctx, SERVICE),
    'accept': 'application/json',
  }
  if (input.body !== undefined) headers['content-type'] = 'application/json'

  const response = await guardedFetch(buildUrl(input.path, input.query), {
    method: input.method ?? 'GET',
    headers,
    body: input.body === undefined ? undefined : JSON.stringify(input.body),
  })

  const body = await response.text()
  let payload: unknown = {}
  if (body.trim() !== '') {
    try {
      payload = JSON.parse(body)
    } catch {
      // 2xx 上回非 JSON 只能是上游坏了;错误响应回 HTML 错误页却很常见,那时按 HTTP
      // 状态归一比报"响应不是 JSON"准得多。
      if (response.ok) {
        throw new TBError('unavailable', 'CircleCI 返回了非 JSON 响应', { retryable: true })
      }
      payload = body
    }
  }
  if (!response.ok) throw upstreamError(response.status, errorMessage(payload, response.status))
  return payload
}

export function getCurrentUser(_input: unknown, ctx: ProviderContext): Promise<unknown> {
  return request(ctx, { path: '/me' })
}

export function getProject(input: z.infer<typeof getProjectInput>, ctx: ProviderContext): Promise<unknown> {
  return request(ctx, { path: `/project/${encodeURIComponent(projectSlug(input.projectSlug))}` })
}

export function listPipelinesForProject(
  input: z.infer<typeof listPipelinesForProjectInput>,
  ctx: ProviderContext,
): Promise<unknown> {
  return request(ctx, {
    path: `/project/${encodeURIComponent(projectSlug(input.projectSlug))}/pipeline`,
    // 入参是 camelCase 的 pageToken,上游 query 键却是连字符的 `page-token`。
    query: { 'branch': text(input.branch), 'page-token': text(input.pageToken) },
  })
}

export function getPipeline(input: z.infer<typeof getPipelineInput>, ctx: ProviderContext): Promise<unknown> {
  return request(ctx, { path: `/pipeline/${encodeURIComponent(input.pipelineId.trim())}` })
}

export function listWorkflowsByPipeline(
  input: z.infer<typeof listWorkflowsByPipelineInput>,
  ctx: ProviderContext,
): Promise<unknown> {
  return request(ctx, {
    path: `/pipeline/${encodeURIComponent(input.pipelineId.trim())}/workflow`,
    query: { 'page-token': text(input.pageToken) },
  })
}

export function getWorkflowSummary(
  input: z.infer<typeof getWorkflowSummaryInput>,
  ctx: ProviderContext,
): Promise<unknown> {
  if (typeof input.allBranches === 'boolean' && text(input.branch) !== undefined) {
    // 两个都给上游会静默只认一个,调用方拿到的是"看起来对但范围不对"的数据。
    throw new TBError('invalid_argument', 'allBranches 与 branch 不能同时使用')
  }
  const slug = encodeURIComponent(projectSlug(input.projectSlug))
  const workflow = encodeURIComponent(input.workflowName.trim())
  return request(ctx, {
    path: `/insights/${slug}/workflows/${workflow}/summary`,
    query: {
      'all-branches': typeof input.allBranches === 'boolean' ? String(input.allBranches) : undefined,
      'branch': text(input.branch),
    },
  })
}

export function getJobDetails(input: z.infer<typeof getJobDetailsInput>, ctx: ProviderContext): Promise<unknown> {
  return request(ctx, {
    path: `/project/${encodeURIComponent(projectSlug(input.projectSlug))}/job/${input.jobNumber}`,
  })
}

export function getJobArtifacts(input: z.infer<typeof getJobArtifactsInput>, ctx: ProviderContext): Promise<unknown> {
  return request(ctx, {
    // 注意这里**没有** `/job/` 段 —— 与 get_job_details 不对称,是 CircleCI API 的原样。
    path: `/project/${encodeURIComponent(projectSlug(input.projectSlug))}/${input.jobNumber}/artifacts`,
  })
}

export function listInsightsSummary(
  input: z.infer<typeof listInsightsSummaryInput>,
  ctx: ProviderContext,
): Promise<unknown> {
  return request(ctx, {
    path: `/insights/${encodeURIComponent(orgSlug(input.orgSlug))}/summary`,
    query: { 'reporting-window': text(input.reportingWindow) },
  })
}

export function triggerPipeline(input: z.infer<typeof triggerPipelineInput>, ctx: ProviderContext): Promise<unknown> {
  const branch = text(input.branch)
  const tag = text(input.tag)
  if (branch !== undefined && tag !== undefined) {
    throw new TBError('invalid_argument', 'branch 与 tag 不能同时使用')
  }
  const body: Json = {}
  if (branch !== undefined) body.branch = branch
  if (tag !== undefined) body.tag = tag
  const parameters = record(input.parameters)
  if (parameters !== undefined) body.parameters = parameters

  return request(ctx, {
    method: 'POST',
    path: `/project/${encodeURIComponent(projectSlug(input.projectSlug))}/pipeline`,
    body,
  })
}

export function listProjectEnvVars(
  input: z.infer<typeof listProjectEnvVarsInput>,
  ctx: ProviderContext,
): Promise<unknown> {
  return request(ctx, { path: `/project/${encodeURIComponent(projectSlug(input.projectSlug))}/envvar` })
}
