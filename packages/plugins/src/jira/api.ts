/**
 * Jira(Data Center / Server)的业务逻辑。
 *
 * 迁移自 open-connector `src/providers/jira/executors.ts`,语义等价、写法本地化:
 * 凭证经 `ctx.credentials` 取(多字段),出站走 `guardedFetch`,错误抛 `TBError` 七码。
 * 凭证走 `Authorization: Bearer` 请求头,不进 URL。
 *
 * **只迁 `custom_credential`(Data Center / Server + PAT)这一条路径。** 上游同一份 executors
 * 同时服务 Cloud OAuth 与 DC PAT,靠 `deployment` 开关分流;Cloud 那半边要平台的 providerOAuth
 * 支撑(C 层任务),本 plugin 声明的凭证是 baseUrl + personalAccessToken,故这里只保留
 * `deployment === 'server'` 的分支。被略去的 Cloud 专属逻辑有:`/rest/api/3` 的 cloudId base URL、
 * `/project/search` 与 `/search/jql` 两个增强端点、`nextPageToken` 游标、以及把纯文本转成
 * ADF 文档。要补 Cloud 时它们在上游原文里是完整的一块,不必重推。
 *
 * 五处上游细节决定了这里的形状:
 * - **baseUrl 是租户自填的实例地址**,故它同时是出站边界:必须是公网 http(s)、不许内嵌凭证、
 *   query 与 fragment 剥掉、末尾若已带 `/rest/api/{2,3,latest}` 要先摘掉再钉到 `/rest/api/2`
 *   (否则用户粘贴一个 API 地址就会双拼成 404)。
 * - **每个请求的目标都要再验一次落在 base URL 之内** —— `create_issue` 会跟着上游返回的
 *   `self` 绝对地址走,不验就等于让上游指哪打哪。
 * - **DC 没有分页版 `/project/search`**,只能拉全量 `/project` 再在内存里切页;上游如此,照搬
 *   (它注释里解释过为什么不缓存:无状态运行时里缓存换来的是陈旧与无界内存)。
 * - **`fields` 在两个端点上形状不同**:`POST /search` 收字符串数组,`GET /issue/{id}` 收逗号串。
 *   写反了一个要么 400 要么静默返回全字段。
 * - **DC 的评论正文是纯文本**,不是 ADF。给了 ADF 文档就地拍平成纯文本。
 *
 * 与上游的三处有意偏离(都在错误归一上,理由是 tool-bridge 的七码语义):
 * - 上游把**非权限文案的 403** 压成 502(可重试)。403 是权限问题,重试永远不会变,
 *   故这里一律归 permission_denied。
 * - 上游把 `notFoundAsInvalidInput` 的 404 压成 400。这里保留 not_found —— 调用方要能区分
 *   "参数不对"和"这个 issue 不存在"。
 * - 上游把其余所有状态(含 409 之类)统统压成 502。这里走公共 `upstreamError`,按状态归一。
 */

import type { z } from 'zod/v4'
import { TBError } from '@tool-bridge/plugin-sdk'
import type {
  addCommentInput,
  createIssueInput,
  getIssueInput,
  getProjectInput,
  listIssueCommentsInput,
  listProjectsInput,
  searchIssuesInput,
} from './schema'
import {
  booleanValue as boolean,
  compactDefined as compact,
  integerValue as integer,
  asJsonObject as record,
  trimmedText as text,
} from '../_runtime/jsonValue'
import { createProviderHttpClient, type ResponseBodyKind } from '../_runtime/providerHttp'
import { type ProviderContext, requireCredential } from '../_runtime/plugin'
import { assertPublicHttpUrl } from '../_runtime/guardedFetch'
import { upstreamError } from '../_runtime/upstreamError'

const SERVICE = 'jira'
/** 上游显式补的分页默认值。 */
const DEFAULT_LIMIT = 50
const http = createProviderHttpClient({ service: SERVICE })

/** 每个 issue 至少要回的字段,叠加调用方的 includeFields。 */
const DEFAULT_ISSUE_FIELD_IDS = [
  'summary',
  'description',
  'status',
  'issuetype',
  'project',
  'assignee',
  'reporter',
  'priority',
  'labels',
  'created',
  'updated',
  'duedate',
]

type Json = Record<string, unknown>

function stringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.map(item => text(item)).filter((item): item is string => item !== undefined)
}

function recordArray(value: unknown): Json[] {
  if (!Array.isArray(value)) return []
  return value.map(item => record(item)).filter((item): item is Json => item !== undefined)
}

function joinOptionalList(values: string[]): string | undefined {
  return values.length > 0 ? values.join(',') : undefined
}

function optionalStringList(values: string[]): string[] | undefined {
  return values.length > 0 ? values : undefined
}

function mergeUniqueFieldIds(base: string[], extra: string[]): string[] {
  const merged = [...base]
  for (const field of extra) {
    if (!merged.includes(field)) merged.push(field)
  }
  return merged
}

function isAbsoluteUrl(value: string): boolean {
  return value.startsWith('https://') || value.startsWith('http://')
}

/**
 * 把租户填的实例地址归一成 REST v2 base。
 *
 * 这是**出站边界**:baseUrl 由用户自填,内网地址会被 `assertPublicHttpUrl` 拦下(防 SSRF)。
 * 拦下时不复用它的通用文案 —— 那句话说的是"出站目标",用户看不出问题出在自己配的凭证上。
 */
function apiBaseUrl(ctx: ProviderContext): string {
  const raw = requireCredential(ctx, SERVICE, 'baseUrl')
  let url: URL
  try {
    url = assertPublicHttpUrl(raw)
  } catch {
    // 不回显 baseUrl 本身:错误消息会进日志,凭证字段不该跟着走。
    throw new TBError(
      'invalid_argument',
      'Jira 凭证里的 baseUrl 不是可出站的公网 http(s) 地址 —— 插件会拦下私有网段、回环与云元数据地址'
      + '(防 SSRF)。请把这个 Jira 实例的公网地址填进凭证的 baseUrl 字段',
    )
  }
  if (url.username !== '' || url.password !== '') {
    throw new TBError('invalid_argument', 'Jira 凭证里的 baseUrl 不能内嵌用户名或密码')
  }

  url.hash = ''
  url.search = ''
  // 用户可能直接粘了个 API 地址(…/rest/api/3),先摘掉再钉到本 provider 说的 v2,
  // 否则会双拼成 …/rest/api/3/rest/api/2 而每个请求都 404。
  const path = url.pathname.replace(/\/+$/, '').replace(/\/rest\/api\/(?:2|3|latest)$/, '')
  url.pathname = `${path}/rest/api/2`
  return url.toString().replace(/\/$/, '')
}

/**
 * 拼出站 URL,并再验一次目标仍落在 base URL 之内。
 * `create_issue` 会跟着上游返回的 `self` 绝对地址走 —— 不验这一步就是让上游指哪打哪。
 */
function buildUrl(base: string, pathOrUrl: string, query?: Record<string, string | undefined>): string {
  const target = isAbsoluteUrl(pathOrUrl)
    ? new URL(pathOrUrl)
    : new URL(pathOrUrl.replace(/^\/+/, ''), `${base}/`)
  const baseUrl = new URL(base)
  if (target.origin !== baseUrl.origin || !target.pathname.startsWith(`${baseUrl.pathname}/`)) {
    throw new TBError('invalid_argument', 'jira requests must target the configured API base')
  }
  for (const [key, value] of Object.entries(query ?? {})) {
    // 上游用的是 falsy 判断,空串也跳过 —— 照搬(空 expand 发上去 Jira 会 400)。
    if (value === undefined || value === '') continue
    target.searchParams.set(key, value)
  }
  return target.toString()
}

/** Jira 的错误文案:errorMessages[] 优先,其次 errors{} 逐字段拼,最后 message。 */
function errorMessage(payload: unknown): string {
  const body = record(payload)
  if (body === undefined) return 'jira request failed'

  const messages = stringArray(body.errorMessages)
  if (messages.length > 0) return messages.join('; ')

  const fieldErrors = record(body.errors)
  if (fieldErrors !== undefined) {
    const parts: string[] = []
    for (const [key, value] of Object.entries(fieldErrors)) {
      const message = text(value)
      if (message !== undefined) parts.push(`${key}: ${message}`)
    }
    if (parts.length > 0) return parts.join('; ')
  }

  return text(body.message) ?? 'jira request failed'
}

/** 空 body 当空对象;非 JSON 的错误页塞进 message,保持迁移前 wire。 */
function responsePayload(data: unknown, bodyKind: ResponseBodyKind): unknown {
  if (bodyKind === 'empty') return {}
  return bodyKind === 'invalid-json' ? { message: data } : data
}

interface RequestOptions {
  body?: Json
  method?: 'GET' | 'POST'
  path: string
  query?: Record<string, string | undefined>
}

/** 返回上游 JSON 的原值(可能是数组,如 DC 的 `/project`)。 */
async function requestValue(ctx: ProviderContext, options: RequestOptions): Promise<unknown> {
  const baseUrl = apiBaseUrl(ctx)
  const result = await http.request({
    baseUrl,
    // create_issue 会跟随 Jira 返回的 self；buildUrl 先锁定 origin 与 REST API path 前缀。
    path: buildUrl(baseUrl, options.path, options.query),
    method: options.method ?? (options.body === undefined ? 'GET' : 'POST'),
    headers: {
      accept: 'application/json',
      authorization: `Bearer ${requireCredential(ctx, SERVICE, 'personalAccessToken')}`,
    },
    ...(options.body === undefined ? {} : { json: options.body }),
    invalidJson: 'text',
    mapError: ({ bodyKind, data, status }) => upstreamError(
      status,
      errorMessage(responsePayload(data, bodyKind)),
    ),
  })
  return responsePayload(result.data, result.bodyKind)
}

/** 同上,但契约说好回对象。 */
async function requestObject(ctx: ProviderContext, options: RequestOptions): Promise<Json> {
  const payload = await requestValue(ctx, options)
  const body = record(payload)
  if (body === undefined) throw upstreamError(502, 'jira response payload must be a JSON object')
  return body
}

/** DC 的 startAt 游标是个非负整数串;给别的东西要当场拒,不能默默当 0。 */
function parseCursor(value: unknown): number {
  const cursor = text(value)
  if (cursor === undefined) return 0
  const parsed = Number(cursor)
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new TBError('invalid_argument', 'cursor must be a non-negative integer string')
  }
  return parsed
}

function nextNumericCursor(startAt: number, itemCount: number, total?: number, isLast?: boolean): string | null {
  if (itemCount === 0) return null
  if (isLast === true) return null
  if (typeof total === 'number' && startAt + itemCount >= total) return null
  return String(startAt + itemCount)
}

function requireText(value: unknown, field: string): string {
  const result = text(value)
  if (result === undefined) throw new TBError('invalid_argument', `${field} is required`)
  return result
}

function normalizeUser(value: unknown): Json | undefined {
  const user = record(value)
  if (user === undefined) return undefined
  return compact({
    accountId: text(user.accountId),
    accountType: text(user.accountType),
    // DC 用 name/key 标识用户,而不是 Cloud 的 accountId。
    name: text(user.name),
    key: text(user.key),
    displayName: text(user.displayName),
    emailAddress: text(user.emailAddress),
    active: boolean(user.active),
    self: text(user.self),
    timeZone: text(user.timeZone),
  })
}

function normalizeNamedReference(value: unknown): Json | undefined {
  const reference = record(value)
  if (reference === undefined) return undefined
  return compact({
    id: text(reference.id),
    name: text(reference.name),
    key: text(reference.key),
    self: text(reference.self),
    description: text(reference.description),
  })
}

function normalizeProject(project: Json): Json {
  return compact({
    id: text(project.id),
    key: text(project.key),
    name: text(project.name),
    self: text(project.self),
    description: text(project.description),
    projectTypeKey: text(project.projectTypeKey),
    simplified: boolean(project.simplified),
    style: text(project.style),
    url: text(project.url),
    lead: normalizeUser(project.lead),
    projectCategory: normalizeNamedReference(project.projectCategory),
    avatarUrls: record(project.avatarUrls),
    raw: project,
  })
}

function normalizeIssue(issue: Json): Json {
  const fields = record(issue.fields) ?? {}
  return compact({
    id: text(issue.id),
    key: text(issue.key),
    self: text(issue.self),
    summary: text(fields.summary),
    description: fields.description,
    status: normalizeNamedReference(fields.status),
    issueType: normalizeNamedReference(fields.issuetype),
    project: record(fields.project) === undefined ? undefined : normalizeProject(record(fields.project)!),
    assignee: normalizeUser(fields.assignee),
    reporter: normalizeUser(fields.reporter),
    priority: normalizeNamedReference(fields.priority),
    labels: stringArray(fields.labels),
    created: text(fields.created),
    updated: text(fields.updated),
    dueDate: text(fields.duedate),
    fields,
    raw: issue,
  })
}

function normalizeComment(comment: Json): Json {
  return compact({
    id: text(comment.id),
    self: text(comment.self),
    body: comment.body,
    author: normalizeUser(comment.author),
    updateAuthor: normalizeUser(comment.updateAuthor),
    created: text(comment.created),
    updated: text(comment.updated),
    jsdPublic: boolean(comment.jsdPublic),
    raw: comment,
  })
}

/** 节点内的可见文本:不 trim(见 `adfToPlainText` 的偏离说明),但空串等于没有。 */
function rawText(value: unknown): string | undefined {
  return typeof value === 'string' && value !== '' ? value : undefined
}

function appendAdfText(value: unknown, parts: string[]): void {
  const node = record(value)
  if (node === undefined) return

  const type = text(node.type)
  if (type === 'text') {
    const content = rawText(node.text)
    if (content !== undefined) parts.push(content)
  } else if (type === 'hardBreak') {
    parts.push('\n')
  } else if (type === 'mention' || type === 'emoji' || type === 'date' || type === 'status') {
    // 这几种行内节点的可见文本挂在 attrs.text 上,没有 text 子节点。
    const content = rawText(record(node.attrs)?.text)
    if (content !== undefined) parts.push(content)
  } else if (type === 'inlineCard') {
    const url = rawText(record(node.attrs)?.url)
    if (url !== undefined) parts.push(url)
  }

  const children = Array.isArray(node.content) ? node.content : []
  for (const child of children) appendAdfText(child, parts)
  if (children.length > 0 && (type === 'paragraph' || type === 'heading' || type === 'listItem')) {
    parts.push('\n')
  }
}

/**
 * ADF 文档拍平成纯文本。DC 的正文字段收的是纯文本,调用方却可能按 Cloud 的习惯递一份 ADF,
 * 故就地降级而不是拒绝。块级节点(paragraph / heading / listItem)结束时补换行。
 *
 * 与上游的有意偏离:上游对每个节点的可见文本都套了通用的 `optionalString`(**会 trim**),
 * 于是 `"ping " + @mention` 会被拼成 `ping@jdoe` —— 词间空格在拼接处丢掉。这里节点内文本
 * 原样取用,只在整篇拼完后 trim 一次(与上游的外层行为一致)。
 */
function adfToPlainText(value: Json): string {
  const parts: string[] = []
  appendAdfText(value, parts)
  return parts.join('').replace(/\n{3,}/g, '\n\n').trim()
}

export async function listProjects(
  input: z.infer<typeof listProjectsInput>,
  ctx: ProviderContext,
): Promise<Json> {
  const limit = input.limit ?? DEFAULT_LIMIT
  const startAt = parseCursor(input.cursor)

  // DC 没有分页版 /project/search,只能拉全量再在内存里切页(上游如此)。
  const payload = await requestValue(ctx, {
    path: '/project',
    query: compact({ expand: joinOptionalList(stringArray(input.expand)) }),
  })
  const projects = recordArray(payload).map(project => normalizeProject(project))
  const page = projects.slice(startAt, startAt + limit)

  return {
    projects: page,
    pagination: {
      nextCursor: startAt + page.length < projects.length ? String(startAt + page.length) : null,
    },
  }
}

export async function getProject(input: z.infer<typeof getProjectInput>, ctx: ProviderContext): Promise<Json> {
  const payload = await requestObject(ctx, {
    path: `/project/${encodeURIComponent(requireText(input.projectIdOrKey, 'projectIdOrKey'))}`,
    query: compact({ expand: joinOptionalList(stringArray(input.expand)) }),
  })
  return { project: normalizeProject(payload) }
}

export async function searchIssues(
  input: z.infer<typeof searchIssuesInput>,
  ctx: ProviderContext,
): Promise<Json> {
  const startAt = parseCursor(input.cursor)
  const payload = await requestObject(ctx, {
    path: '/search',
    method: 'POST',
    body: compact({
      jql: requireText(input.jql, 'jql'),
      maxResults: input.limit ?? DEFAULT_LIMIT,
      // DC 的 POST /rest/api/2/search 绑的是 SearchRequestBean,fields 与 expand 都收**数组**;
      // Cloud 的增强端点收逗号串 —— 两边形状不同,写反了要么 400 要么静默全字段。
      fields: mergeUniqueFieldIds(DEFAULT_ISSUE_FIELD_IDS, stringArray(input.includeFields)),
      startAt,
      expand: optionalStringList(stringArray(input.expand)),
    }),
  })

  const issues = recordArray(payload.issues)
  return {
    issues: issues.map(issue => normalizeIssue(issue)),
    pagination: {
      nextCursor: nextNumericCursor(startAt, issues.length, integer(payload.total)),
    },
  }
}

export async function getIssue(input: z.infer<typeof getIssueInput>, ctx: ProviderContext): Promise<Json> {
  const payload = await requestObject(ctx, {
    path: `/issue/${encodeURIComponent(requireText(input.issueIdOrKey, 'issueIdOrKey'))}`,
    query: compact({
      // 这个端点上 fields 是**逗号串**,不是数组。
      fields: joinOptionalList(mergeUniqueFieldIds(DEFAULT_ISSUE_FIELD_IDS, stringArray(input.includeFields))),
      expand: joinOptionalList(stringArray(input.expand)),
    }),
  })
  return { issue: normalizeIssue(payload) }
}

/** project 引用二选一:id 优先于 key,两个都没有就拒。 */
function projectReference(input: z.infer<typeof createIssueInput>): Json {
  const projectId = text(input.projectId)
  if (projectId !== undefined) return { id: projectId }
  const projectKey = text(input.projectKey)
  if (projectKey !== undefined) return { key: projectKey }
  throw new TBError('invalid_argument', 'projectKey or projectId is required')
}

/** issuetype 引用二选一:id 优先于 name,两个都没有就拒。 */
function issueTypeReference(input: z.infer<typeof createIssueInput>): Json {
  const issueTypeId = text(input.issueTypeId)
  if (issueTypeId !== undefined) return { id: issueTypeId }
  const issueTypeName = text(input.issueTypeName)
  if (issueTypeName !== undefined) return { name: issueTypeName }
  throw new TBError('invalid_argument', 'issueTypeId or issueTypeName is required')
}

export async function createIssue(input: z.infer<typeof createIssueInput>, ctx: ProviderContext): Promise<Json> {
  const description = record(input.description)
  const explicitFields = compact({
    project: projectReference(input),
    issuetype: issueTypeReference(input),
    summary: requireText(input.summary, 'summary'),
    // DC 的 description 是纯文本:给了 ADF 就拍平,只给了 descriptionText 就直接用。
    description: description !== undefined ? adfToPlainText(description) : text(input.descriptionText),
    // 上游这里用的是 `readStringArray`,没给 labels 时得到的是 `[]` 而非 undefined,于是
    // 创建请求总会带上 `labels: []`。保留这个行为(创建时本就没有标签,发空数组无副作用)。
    labels: stringArray(input.labels),
    assignee: text(input.assigneeAccountId) === undefined
      ? undefined
      // DC 按 name 认人,不是 Cloud 的 accountId(入参名沿用上游,含义随部署形态而变)。
      : { name: text(input.assigneeAccountId) },
    priority: text(input.priorityId) === undefined ? undefined : { id: text(input.priorityId) },
    duedate: text(input.dueDate),
    parent: text(input.parentIssueKey) === undefined ? undefined : { key: text(input.parentIssueKey) },
  })

  const created = await requestObject(ctx, {
    path: '/issue',
    method: 'POST',
    // extraFields 在前:同名键由显式入参覆盖,免得裸传的 extraFields 悄悄改掉 summary 之类。
    body: { fields: { ...(record(input.extraFields) ?? {}), ...explicitFields } },
  })

  // 创建响应只有 id/key/self,要的却是完整 issue,故回查一次。
  const createdRef = text(created.key) ?? text(created.id) ?? text(created.self)
  if (createdRef === undefined) throw upstreamError(502, 'missing jira created issue self')
  const issue = await requestObject(ctx, {
    // self 是绝对地址,`buildUrl` 会验它仍落在 base URL 之内。
    path: isAbsoluteUrl(createdRef) ? createdRef : `/issue/${encodeURIComponent(createdRef)}`,
    query: { fields: joinOptionalList(DEFAULT_ISSUE_FIELD_IDS) },
  })
  return { issue: normalizeIssue(issue) }
}

export async function listIssueComments(
  input: z.infer<typeof listIssueCommentsInput>,
  ctx: ProviderContext,
): Promise<Json> {
  const limit = input.limit ?? DEFAULT_LIMIT
  const startAt = parseCursor(input.cursor)
  const payload = await requestObject(ctx, {
    path: `/issue/${encodeURIComponent(requireText(input.issueIdOrKey, 'issueIdOrKey'))}/comment`,
    query: compact({
      maxResults: String(limit),
      startAt: String(startAt),
      expand: joinOptionalList(stringArray(input.expand)),
    }),
  })

  const comments = recordArray(payload.comments).map(comment => normalizeComment(comment))
  return {
    comments,
    pagination: { nextCursor: nextNumericCursor(startAt, comments.length, integer(payload.total)) },
  }
}

export async function addComment(input: z.infer<typeof addCommentInput>, ctx: ProviderContext): Promise<Json> {
  const document = record(input.body)
  // DC 的评论正文是纯文本。递了 ADF 就拍平,两个都没给就拒 —— 发空串会创建一条空评论。
  const body = document !== undefined ? adfToPlainText(document) : text(input.bodyText)
  if (body === undefined || body === '') {
    throw new TBError('invalid_argument', 'comment body or bodyText is required')
  }

  const payload = await requestObject(ctx, {
    path: `/issue/${encodeURIComponent(requireText(input.issueIdOrKey, 'issueIdOrKey'))}/comment`,
    method: 'POST',
    body: { body },
  })
  return { comment: normalizeComment(payload) }
}
