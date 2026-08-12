/**
 * GitHub 各 handler 共用的请求层:URL/路径拼装、凭证、错误归一、内容编解码。
 *
 * 迁移自 open-connector `src/providers/github/runtime-shared.ts`。145 个 action 分散在
 * 同目录的六个模块里(与上游的 runtime-* 分组一一对应),它们的差异只在"打哪个端点、
 * 塞什么参数、怎么裁响应";凡是所有 action 都一样的东西都收在这里。
 *
 * 凭证在 **header**(`authorization: Bearer <token>`),不在 URL。
 *
 * 三处上游细节决定了这里的形状:
 *
 * 1. **403 身兼两职**。GitHub 用 403 同时表达"触发限流"与"权限不足",但两者对调用方
 *    是相反的指令:前者等一会儿重试就好,后者重试一万次也没用。判据是响应头
 *    `x-ratelimit-remaining: 0` / `retry-after`,或消息里含 "rate limit"。分不清就会
 *    让 agent 对一个永远不会变的权限错误无限重试(或反过来,把可恢复的限流当成死路)。
 * 2. **空响应体是正常的**。204(以及空仓库的 contributors)回来没有 body,`readJson`
 *    把它读成 `null` 而不是报解析失败 —— 有三个 action 正是靠"204 还是 404"表达布尔结果。
 * 3. **分页只有 per_page/page**。GitHub 的 `Link` 头带着 next/last,但上游的出参声明里
 *    没有承载它的字段,故这层不透出;唯一被保留的分页信号是 `list_repository_issues`
 *    的 `pageInfo.fetched`(见 issue.ts 的说明)。同理,上游没有条件请求(ETag/If-None-Match)
 *    的入参字段,故这里也不发条件请求 —— 不会出现需要特殊处理的 304。
 */

import { TBError } from '@tool-bridge/plugin-sdk'
import { type ProviderContext, requireApiKey } from '../../_runtime/plugin'
import { upstreamError } from '../../_runtime/upstreamError'
import { guardedFetch } from '../../_runtime/guardedFetch'

export const SERVICE = 'github'
const API_BASE = 'https://api.github.com'
const API_VERSION = '2022-11-28'
/** GitHub REST 强制要求 User-Agent,缺了直接 403。上游报的是它自己的名字,这里报我们的。 */
const USER_AGENT = 'tool-bridge'

export type Json = Record<string, unknown>
export type Query = Record<string, boolean | number | string | undefined>

/**
 * 上游有两族字符串取值,分别是**有意**的:
 * - `optionalString`:去空白,空串当成没给 —— 用在 `sha` / `branch` / `homepage` 这类
 *   "空等于没有"的字段上。本文件的 `text()` 就是它。
 * - `optionalRawString`:原样保留,**含空串** —— 用在 `body` / `description` / `title`
 *   这类"空串意味着清空"的字段上。Zod 已保证它们是 `string | undefined`,故直接传值。
 *
 * 把后者错写成前者,就会出现"想把 issue 正文清空却发现改不动"这种查不出来的 bug。
 */
export function text(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  return trimmed === '' ? undefined : trimmed
}

export function record(value: unknown): Json | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Json) : undefined
}

/** 上游用 `Array.isArray(x) ? x : []` 兜底,保留:少一族结果比整个调用失败好。 */
export function objectArray(value: unknown): Json[] {
  return Array.isArray(value) ? (value as Json[]) : []
}

/** 契约说好是数组的端点回了别的东西 —— 上游违约,不是调用方的错。 */
export function requireArray(value: unknown, label: string): Json[] {
  if (!Array.isArray(value)) {
    throw new TBError('unavailable', `${label}不是数组`, { retryable: true })
  }
  return value as Json[]
}

export function requireRecord(value: unknown, label: string): Json {
  const result = record(value)
  if (result === undefined) {
    throw new TBError('unavailable', `${label}不是对象`, { retryable: true })
  }
  return result
}

/** 计数字段:上游一律 `Number(x ?? 0)`,缺失即 0。 */
export function count(value: unknown): number {
  const parsed = Number(value ?? 0)
  return Number.isFinite(parsed) ? parsed : 0
}

/** 缺配置但 schema 说是可选的字段(上游在 executor 里断言过),照抄断言。 */
export function requireText(value: string | undefined, field: string): string {
  const result = text(value)
  if (result === undefined) throw new TBError('invalid_argument', `${field} 是必填的`)
  return result
}

/** `/repos/{owner}/{repo}{suffix}`;suffix 里的可变段由调用方自己编码。 */
export function repoPath(owner: string, repo: string, suffix = ''): string {
  return `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}${suffix}`
}

/**
 * contents API 的路径:逐段编码但**保留段之间的斜杠**(`encodeURIComponent(path)` 会把
 * `/` 编成 `%2F`,打到的就不是同一个资源了),并去掉首尾多余的斜杠。
 */
export function contentsPath(owner: string, repo: string, path?: string): string {
  const segments = (path ?? '').split('/').filter(segment => segment !== '')
  const encoded = segments.map(segment => encodeURIComponent(segment)).join('/')
  return repoPath(owner, repo, `/contents${encoded === '' ? '' : `/${encoded}`}`)
}

/** git ref(`heads/main`、`tags/v1.0`)同样是逐段编码、保留斜杠。 */
export function refPath(ref: string): string {
  return ref.split('/').map(segment => encodeURIComponent(segment)).join('/')
}

/**
 * git ref 端点只接受 `heads/` 或 `tags/` 开头的 ref。上游在本地断言,保留:
 * 传 `refs/heads/main` 或裸分支名都会打到一个 404 上,报"ref 不存在"比报形状错误更误导人。
 */
export function requireBranchOrTagRef(ref: string): string {
  if (!ref.startsWith('heads/') && !ref.startsWith('tags/')) {
    throw new TBError('invalid_argument', 'ref 必须以 heads/ 或 tags/ 开头')
  }
  return ref
}

function buildUrl(path: string, query: Query | undefined): string {
  const url = new URL(`${API_BASE}${path}`)
  for (const [key, value] of Object.entries(query ?? {})) {
    if (value !== undefined) url.searchParams.set(key, String(value))
  }
  return url.toString()
}

function headers(ctx: ProviderContext, hasJsonBody: boolean): Record<string, string> {
  const result: Record<string, string> = {
    'accept': 'application/vnd.github+json',
    'authorization': `Bearer ${requireApiKey(ctx, SERVICE)}`,
    'x-github-api-version': API_VERSION,
    'user-agent': USER_AGENT,
  }
  if (hasJsonBody) result['content-type'] = 'application/json'
  return result
}

/** 空 body 读成 `null`(204/205);非 JSON 读成 `{message}`,好让错误页的文字进错误消息。 */
async function readJson(response: Response): Promise<unknown> {
  const body = await response.text()
  if (body === '') return null
  try {
    return JSON.parse(body)
  } catch {
    return { message: body }
  }
}

/** 限流判据:配额头归零、带 retry-after(二级限流),或消息里明说了。 */
function isRateLimited(response: Response, message: string): boolean {
  if (response.headers.get('x-ratelimit-remaining') === '0') return true
  if (response.headers.get('retry-after') !== null) return true
  return message.toLowerCase().includes('rate limit')
}

/**
 * 422 的 `message` 恒为 "Validation Failed",真正有用的信息在 `errors[]` 里。上游把它丢了,
 * 这里补上一行摘要 —— agent 拿到 "field: reason" 才能自己改对下一次调用。
 */
function validationDetail(payload: unknown): string | undefined {
  const errors = record(payload)?.errors
  if (!Array.isArray(errors)) return undefined
  const details = errors
    .map((item) => {
      const entry = record(item)
      if (entry === undefined) return text(item)
      const field = text(entry.field) ?? text(entry.resource)
      const reason = text(entry.message) ?? text(entry.code)
      if (field !== undefined && reason !== undefined) return `${field}: ${reason}`
      return reason ?? field
    })
    .filter((item): item is string => item !== undefined)
  return details.length > 0 ? details.join('; ') : undefined
}

export function githubError(response: Response, payload: unknown): TBError {
  const base = text(record(payload)?.message) ?? `GitHub 返回 HTTP ${response.status}`
  const detail = validationDetail(payload)
  const message = detail === undefined ? base : `${base}(${detail})`
  // 403 身兼两职:限流可重试,权限不足不可重试。归错了 agent 就会一直撞同一堵墙。
  if (response.status === 403 && isRateLimited(response, message)) {
    return upstreamError(429, message)
  }
  return upstreamError(response.status, message)
}

export interface GitHubRequest {
  body?: Json
  method?: string
  path: string
  query?: Query
}

/** 不抛错的底层出站:三个"靠状态码表达布尔结果"的 action 需要自己看 status。 */
export async function requestRaw(
  ctx: ProviderContext,
  input: GitHubRequest,
): Promise<{ payload: unknown, response: Response }> {
  const response = await guardedFetch(buildUrl(input.path, input.query), {
    method: input.method ?? 'GET',
    headers: headers(ctx, input.body !== undefined),
    body: input.body === undefined ? undefined : JSON.stringify(input.body),
  })
  return { payload: await readJson(response), response }
}

export async function requestJson(ctx: ProviderContext, input: GitHubRequest): Promise<unknown> {
  const { payload, response } = await requestRaw(ctx, input)
  if (!response.ok) throw githubError(response, payload)
  return payload
}

export async function requestRecord(ctx: ProviderContext, input: GitHubRequest): Promise<Json> {
  return requireRecord(await requestJson(ctx, input), 'GitHub 响应')
}

export async function requestArray(ctx: ProviderContext, input: GitHubRequest): Promise<Json[]> {
  return requireArray(await requestJson(ctx, input), 'GitHub 响应')
}

/** 期待 204 的写操作:响应体一律丢弃,只在失败时读出来做错误消息。 */
export async function requestNoContent(ctx: ProviderContext, input: GitHubRequest): Promise<void> {
  const { payload, response } = await requestRaw(ctx, input)
  if (!response.ok) throw githubError(response, payload)
}

/** 丢掉值为 undefined 的键(上游 `compactObject`);`null` 要留住。 */
export function compact(input: Record<string, unknown>): Json {
  return Object.fromEntries(Object.entries(input).filter(([, value]) => value !== undefined))
}

/**
 * base64 → UTF-8 文本。解不出来(不是 base64、或不是合法 UTF-8,例如二进制文件)返回
 * `undefined`,由调用方决定怎么表达"这份内容没法当文本看"。
 *
 * 不用 `Buffer`:插件按 Web 标准运行时写(Worker / Deno / Bun / Node),`atob` 才是各家都有的那个。
 */
export function decodeContent(contentBase64: string, encoding: string | undefined): string | undefined {
  if (contentBase64 === '') return ''
  if (encoding !== undefined && encoding !== 'base64') return undefined
  try {
    const binary = atob(contentBase64)
    const bytes = new Uint8Array(binary.length)
    for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i)
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch {
    return undefined
  }
}

/**
 * 写文件时的内容取值:`contentBase64` 优先(原样,但去掉换行 —— GitHub 不收带换行的 base64),
 * 否则把 `content` 当 UTF-8 文本编码。两个都没给就写空文件,与上游一致。
 */
export function encodeContent(input: { content?: string, contentBase64?: string }): string {
  const contentBase64 = input.contentBase64
  if (contentBase64 !== undefined && contentBase64 !== '') {
    return contentBase64.replace(/[\r\n]/g, '')
  }
  const bytes = new TextEncoder().encode(input.content ?? '')
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary)
}

export type { ProviderContext }
