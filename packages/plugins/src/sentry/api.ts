/**
 * Sentry 的业务逻辑。
 *
 * 迁移自 open-connector `src/providers/sentry/runtime.ts`,语义等价、写法本地化:
 * 出站走 `guardedFetch`,错误抛 `TBError` 七码。
 *
 * **凭证**:`requireApiKey(ctx, SERVICE)` 拿到的是**平台换来并按需刷新的 access token**
 * (Sentry 是 provider 型 OAuth2,见 `index.ts` 的 `oauth` 声明)。插件不需要知道它是
 * OAuth 来的 —— 走 `Authorization: Bearer <token>` 头,与 api_key 型 provider 的取法完全一样;
 * 授权码流程、refresh、client_id/secret 全在平台侧,插件既拿不到也不该拿到。凭证不进 URL。
 *
 * 六处上游细节决定了这里的形状:
 * - **base URL 带尾斜杠**(`https://sentry.io/api/0/`),各 path 是**不带前导斜杠的相对路径**
 *   且自身**以斜杠结尾**。这不是风格问题:`new URL('organizations/', base)` 才拼出
 *   `/api/0/organizations/`;写成 `/organizations/` 会把 `/api/0` 整段吃掉,而 Sentry 对
 *   缺尾斜杠的路径会 301 重定向。
 * - **只在 content-type 含 `application/json` 时才解析响应体**(上游 `readJsonResponse`),
 *   否则一律当 `null`。Sentry 的 4xx 常带 HTML 错误页,当 JSON 解会得到一个假消息。
 * - **分页游标藏在 `Link` 头里**,不在 body。要手写解析:`rel="next"` 且 `results!="false"`,
 *   游标优先取 `cursor="..."` 属性、退回从 `<url>` 的 query 里取。四个 action 透出游标。
 * - `shortIdLookup` 是 **`1`/`0`** 而不是 `true`/`false`(上游 `oneZeroFlag`)—— Sentry 这个
 *   参数只认数字串。
 * - `get_release_health_stats` 的 `version` **不进路径**:它打的是 `sessions/` 端点,版本号
 *   拼成搜索子句 `release:<version>` 与调用方的 `query` 用空格连起来。
 * - alerts 走 `workflows/` 端点,响应可能是裸数组也可能包在 `{data: ...}` 里,两种都要认。
 *
 * 与上游的两处有意偏离:
 * - 上游 `normalizeSentryError` 把 401/403 都压成 401。这里走公共表:403 是
 *   `permission_denied`(scope 不够)、404 是 `not_found` —— 这三种情况调用方的下一步动作不同。
 * - 各 `normalizeXxx` 里上游对"形状不符"抛 502;这里归 `unavailable` + `retryable`(同义,
 *   但走 `TBError` 才不会被 plugin-sdk 抹成 `internal` 500)。
 */

import type { z } from 'zod/v4'
import { TBError } from '@tool-bridge/plugin-sdk'
import type {
  getAlertInput,
  getIssueEventInput,
  getIssueInput,
  getOrganizationIntegrationConfigInput,
  getOrganizationIntegrationInput,
  getOrganizationReleaseInput,
  getProjectInput,
  getReleaseHealthStatsInput,
  getReplayInput,
  getSentryAppInput,
  listAlertsInput,
  listIssueEventsInput,
  listOrganizationIntegrationsInput,
  listOrganizationIssuesInput,
  listOrganizationProjectsInput,
  listOrganizationReleasesInput,
  listOrganizationReplaysInput,
  listOrganizationSentryAppsInput,
  updateIssueInput,
} from './schema'
import { type ProviderContext, requireApiKey } from '../_runtime/plugin'
import { upstreamError } from '../_runtime/upstreamError'
import { guardedFetch } from '../_runtime/guardedFetch'

const SERVICE = 'sentry'
/** 尾斜杠是刻意的:见文件头注释,path 用相对形式拼在它后面。 */
const API_BASE = 'https://sentry.io/api/0/'

type Json = Record<string, unknown>
type QueryValue = boolean | number | string | Array<number | string> | undefined

/** 分页游标对(上游 `parseSentryPaginationCursors` 的返回形状)。 */
interface Cursors {
  nextCursor: string | null
  previousCursor: string | null
}

function record(value: unknown): Json | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Json) : undefined
}

/** 上游 `optionalString`:只认字符串,**不** trim(trim 会把有意义的前后空格吃掉)。 */
function str(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined
}

/** 上游 `nullableString`:不是字符串就 `null`(出参里这些字段声明成 nullable 而非 optional)。 */
function nullableStr(value: unknown): string | null {
  return typeof value === 'string' ? value : null
}

/** 上游 `isNonEmptyString`。 */
function nonEmpty(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

/** 上游 `pickString`:取第一个去空白后非空的字符串。 */
function pickStr(...values: unknown[]): string | undefined {
  for (const value of values) {
    if (nonEmpty(value)) return value
  }
  return undefined
}

/** 上游 `nullableInteger`:空/null 归 null,能转成整数才要,否则 null。 */
function nullableInt(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null
  const parsed = Number(value)
  return Number.isInteger(parsed) ? parsed : null
}

/** 上游 `booleanValue`:只有严格 `true` 算真(字符串 'true' 不算)。 */
function bool(value: unknown): boolean {
  return value === true
}

/** 上游 `stringArray`:非数组归空数组,数组里丢掉非字符串项。 */
function strArray(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.filter((item): item is string => typeof item === 'string')
}

/** 上游 `nullableStringArray`:显式 `null` 保留(与"字段缺席"是两回事)。 */
function nullableStrArray(value: unknown): string[] | null {
  return value === null ? null : strArray(value)
}

function arrayValue(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}

/** 上游 `compactObject`:丢掉值为 undefined 的键。 */
function compact(value: Json): Json {
  return Object.fromEntries(Object.entries(value).filter(([, child]) => child !== undefined))
}

/** 上游 `expectRecord`:形状不符是上游违约,不是调用方的错。 */
function expectRecord(value: unknown, label: string): Json {
  const body = record(value)
  if (body === undefined) throw new TBError('unavailable', `Sentry ${label} 响应形状不符`, { retryable: true })
  return body
}

function expectArray(value: unknown, label: string): unknown[] {
  if (!Array.isArray(value)) {
    throw new TBError('unavailable', `Sentry ${label} 响应不是数组`, { retryable: true })
  }
  return value
}

/** 上游 `oneZeroFlag`:Sentry 的 `shortIdLookup` 只认 `1`/`0`。 */
function oneZero(value: boolean | undefined): string | undefined {
  return value === undefined ? undefined : (value ? '1' : '0')
}

/** 上游 `joinSentrySearchClauses`:非空子句用空格连起来。 */
function joinClauses(...clauses: Array<string | undefined>): string | undefined {
  const kept = clauses.filter((clause): clause is string => nonEmpty(clause))
  return kept.length > 0 ? kept.join(' ') : undefined
}

function buildUrl(path: string, query?: Record<string, QueryValue>): string {
  // path 不带前导斜杠 —— 见文件头注释,否则 /api/0 前缀会被整段吃掉。
  const url = new URL(path, API_BASE)
  for (const [key, value] of Object.entries(query ?? {})) {
    if (value === undefined) continue
    if (Array.isArray(value)) {
      // 多值过滤器(environment / project / field …)展开成重复的同名参数。
      for (const item of value) url.searchParams.append(key, String(item))
      continue
    }
    url.searchParams.set(key, String(value))
  }
  return url.toString()
}

/** 上游 `extractSentryErrorMessage`:四个平铺键,再退回 `detail.message` 嵌套形态。 */
function errorMessage(payload: unknown, status: number): string {
  const body = record(payload)
  const nested = str(record(body?.detail)?.message)
  return pickStr(body?.error_description, body?.detail, body?.error, body?.message)
    ?? (nonEmpty(nested) ? nested : undefined)
    ?? `Sentry 返回 HTTP ${status}`
}

/**
 * 只在 content-type 含 `application/json` 时才解析(上游 `readJsonResponse`)。
 * 4xx 常回 HTML 错误页,硬解会得到一个编出来的消息。
 */
async function readJson(response: Response): Promise<unknown> {
  if (!(response.headers.get('content-type') ?? '').includes('application/json')) return null
  try {
    return (await response.json()) as unknown
  } catch {
    return null
  }
}

interface RequestOptions {
  body?: Json
  method?: 'GET' | 'PUT'
  query?: Record<string, QueryValue>
}

interface SentryResponse {
  headers: Headers
  payload: unknown
}

async function request(ctx: ProviderContext, path: string, options: RequestOptions = {}): Promise<SentryResponse> {
  const token = requireApiKey(ctx, SERVICE)
  const headers: Record<string, string> = {
    accept: 'application/json',
    authorization: `Bearer ${token}`,
  }
  if (options.body !== undefined) headers['content-type'] = 'application/json'

  let response: Response
  try {
    response = await guardedFetch(buildUrl(path, options.query), {
      method: options.method ?? 'GET',
      headers,
      ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
    })
  } catch (error) {
    // 传输层失败必须就地归一:漏出去的裸 Error 会被 plugin-sdk 抹成 500,
    // 把"上游不通/出网被拦"说成插件自身故障。
    if (error instanceof TBError) throw error
    throw upstreamError(502, `Sentry 请求失败:${error instanceof Error ? error.message : '未知错误'}`)
  }

  const payload = await readJson(response)
  if (!response.ok) throw upstreamError(response.status, errorMessage(payload, response.status))
  return { payload, headers: response.headers }
}

/**
 * 手写切分 `Link` 头:值里含带逗号的 URL 与带逗号的引号串,`split(',')` 会切坏。
 * 逗号只在**引号外且尖括号外**才算分隔符(上游 `splitLinkHeader`)。
 */
function splitLinkHeader(value: string): string[] {
  const entries: string[] = []
  let current = ''
  let inQuotes = false
  let inAngles = false
  for (const char of value) {
    if (char === '"') {
      inQuotes = !inQuotes
      current += char
      continue
    }
    if (!inQuotes) {
      if (char === '<') inAngles = true
      else if (char === '>') inAngles = false
      else if (char === ',' && !inAngles) {
        if (current.trim() !== '') entries.push(current.trim())
        current = ''
        continue
      }
    }
    current += char
  }
  if (current.trim() !== '') entries.push(current.trim())
  return entries
}

/** 游标优先取 `cursor="..."` 属性;没有就从 `<url>` 的 query 里取。 */
function linkCursor(entry: string): string | null {
  const direct = /\bcursor="([^"]*)"/.exec(entry)?.[1]
  if (nonEmpty(direct)) return direct
  const urlString = /<([^>]*)>/.exec(entry)?.[1]
  if (!nonEmpty(urlString)) return null
  try {
    return new URL(urlString).searchParams.get('cursor')
  } catch {
    return null
  }
}

/**
 * 从 `Link` 头解出前后页游标(上游 `parseSentryPaginationCursors`)。
 * `results="false"` 的那一节要**跳过** —— Sentry 即使没有下一页也会给出 next 链接,
 * 照抄游标会让调用方无限翻页。
 */
function cursors(headers: Headers): Cursors {
  const result: Cursors = { nextCursor: null, previousCursor: null }
  const header = headers.get('link')
  if (!nonEmpty(header)) return result
  for (const entry of splitLinkHeader(header)) {
    const rel = /\brel="([^"]+)"/.exec(entry)?.[1]
    if (rel !== 'next' && rel !== 'previous') continue
    if (/\bresults="([^"]+)"/.exec(entry)?.[1] === 'false') continue
    const cursor = linkCursor(entry)
    if (cursor === null) continue
    if (rel === 'next') result.nextCursor = cursor
    else result.previousCursor = cursor
  }
  return result
}

// ---- 出参整形(逐个对应上游的 normalizeXxx) ----

function normalizeSetupDialog(value: unknown): Json | null {
  const body = record(value)
  if (body === undefined) return null
  return { url: nullableStr(body.url), width: nullableInt(body.width), height: nullableInt(body.height) }
}

function normalizeProviderMetadata(value: unknown): Json | null {
  const body = record(value)
  if (body === undefined) return null
  return {
    noun: nullableStr(body.noun),
    author: nullableStr(body.author),
    description: nullableStr(body.description),
    // Sentry 同一字段在不同端点上 camelCase 与 snake_case 混用,两种都收。
    issueUrl: nullableStr(body.issueUrl ?? body.issue_url),
    sourceUrl: nullableStr(body.sourceUrl ?? body.source_url),
    aspects: record(body.aspects) ?? null,
    features: arrayValue(body.features),
  }
}

function normalizeIntegrationProvider(value: unknown): Json {
  const body = expectRecord(value, 'integration provider')
  return {
    key: str(body.key) ?? '',
    slug: str(body.slug) ?? '',
    name: str(body.name) ?? '',
    canAdd: bool(body.canAdd),
    canDisable: bool(body.canDisable),
    features: strArray(body.features),
    aspects: record(body.aspects) ?? {},
    metadata: normalizeProviderMetadata(body.metadata),
    setupDialog: normalizeSetupDialog(body.setupDialog),
  }
}

function normalizeOrganizationIntegration(value: unknown): Json {
  const body = expectRecord(value, 'integration')
  return {
    id: str(body.id) ?? '',
    name: str(body.name) ?? '',
    icon: nullableStr(body.icon),
    domainName: nullableStr(body.domainName),
    accountType: nullableStr(body.accountType),
    scopes: nullableStrArray(body.scopes),
    status: nullableStr(body.status),
    provider: normalizeIntegrationProvider(body.provider),
    configOrganization: arrayValue(body.configOrganization),
    configData: record(body.configData ?? body.config_data) ?? {},
    externalId: nullableStr(body.externalId),
    organizationId: nullableInt(body.organizationId),
    organizationIntegrationStatus: nullableStr(body.organizationIntegrationStatus),
    gracePeriodEnd: nullableStr(body.gracePeriodEnd),
  }
}

function normalizeSentryAppOwner(value: unknown): Json | null {
  const body = record(value)
  if (body === undefined) return null
  return { id: nullableInt(body.id), slug: nullableStr(body.slug) }
}

function normalizeSentryAppAvatars(value: unknown): Json[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((item) => {
    const body = record(item)
    if (body === undefined) return []
    return [{
      avatarType: str(body.avatarType) ?? '',
      avatarUuid: str(body.avatarUuid) ?? '',
      avatarUrl: str(body.avatarUrl) ?? '',
      color: bool(body.color),
      photoType: str(body.photoType) ?? '',
    }]
  })
}

function normalizeSentryApp(value: unknown): Json {
  const body = expectRecord(value, 'app')
  return {
    name: str(body.name) ?? '',
    slug: str(body.slug) ?? '',
    uuid: str(body.uuid) ?? '',
    owner: normalizeSentryAppOwner(body.owner),
    author: nullableStr(body.author),
    events: strArray(body.events),
    schema: body.schema ?? null,
    scopes: strArray(body.scopes),
    status: str(body.status) ?? '',
    avatars: normalizeSentryAppAvatars(body.avatars),
    clientId: nullableStr(body.clientId),
    metadata: body.metadata ?? null,
    overview: nullableStr(body.overview),
    popularity: nullableInt(body.popularity),
    webhookUrl: nullableStr(body.webhookUrl),
    featureData: arrayValue(body.featureData),
    isAlertable: bool(body.isAlertable),
    redirectUrl: nullableStr(body.redirectUrl),
    // 只透出"有没有",**不透出 clientSecret 本身** —— Sentry App 的 client secret
    // 是另一套凭证,让它经工具出参流到 agent 的上下文里就是一次凭证外泄。
    hasClientSecret: nonEmpty(body.clientSecret),
    verifyInstall: bool(body.verifyInstall),
    allowedOrigins: strArray(body.allowedOrigins),
  }
}

function normalizeTeam(value: unknown): Json | null {
  const body = record(value)
  if (body === undefined) return null
  return { id: nullableStr(body.id), slug: nullableStr(body.slug), name: nullableStr(body.name) }
}

function normalizeTeams(value: unknown): Json[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((item) => {
    const team = normalizeTeam(item)
    return team === null ? [] : [team]
  })
}

function normalizeProject(value: unknown): Json {
  const body = expectRecord(value, 'project')
  return {
    id: str(body.id) ?? '',
    slug: str(body.slug) ?? '',
    name: str(body.name) ?? '',
    platform: nullableStr(body.platform),
    status: nullableStr(body.status),
    dateCreated: nullableStr(body.dateCreated),
    isBookmarked: bool(body.isBookmarked),
    isMember: bool(body.isMember),
    hasAccess: bool(body.hasAccess),
    features: strArray(body.features),
    environments: strArray(body.environments),
    team: normalizeTeam(body.team),
    teams: normalizeTeams(body.teams),
  }
}

/** issue 里内嵌的 project 摘要:形状不符时给 `null` 而不是报错(它不是主体)。 */
function normalizeProjectSummary(value: unknown): Json | null {
  const body = record(value)
  if (body === undefined) return null
  return {
    id: str(body.id) ?? '',
    slug: str(body.slug) ?? '',
    name: str(body.name) ?? '',
    platform: nullableStr(body.platform),
  }
}

function normalizeIssueActor(value: unknown): Json | null {
  const body = record(value)
  if (body === undefined) return null
  return {
    id: nullableStr(body.id),
    type: nullableStr(body.type),
    name: nullableStr(body.name),
    email: nullableStr(body.email),
    username: nullableStr(body.username),
  }
}

function normalizeIssueStatusDetails(value: unknown): Json | null {
  const body = record(value)
  if (body === undefined) return null
  const inNextRelease = body.inNextRelease ?? body.in_next_release
  return {
    inRelease: nullableStr(body.inRelease ?? body.in_release),
    inCommit: nullableStr(body.inCommit ?? body.in_commit),
    inNextRelease: typeof inNextRelease === 'boolean' ? inNextRelease : null,
  }
}

/** issue 的 tags:没有 `key` 的项**整条丢掉**(它是这张表的主键,缺了就没法用)。 */
function normalizeIssueTags(value: unknown): Json[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((item) => {
    const body = record(item)
    if (body === undefined || !nonEmpty(body.key)) return []
    return [{ key: body.key, name: nullableStr(body.name), value: nullableStr(body.value) }]
  })
}

function normalizeIssue(value: unknown): Json {
  const body = expectRecord(value, 'issue')
  return {
    id: str(body.id) ?? '',
    shortId: nullableStr(body.shortId),
    title: nullableStr(body.title),
    culprit: nullableStr(body.culprit),
    level: nullableStr(body.level),
    status: nullableStr(body.status),
    // `count` 上游就是**字符串**(Sentry 回的是 "42"),别顺手改成数字。
    count: nullableStr(body.count),
    userCount: nullableInt(body.userCount),
    firstSeen: nullableStr(body.firstSeen),
    lastSeen: nullableStr(body.lastSeen),
    permalink: nullableStr(body.permalink),
    logger: nullableStr(body.logger),
    isBookmarked: bool(body.isBookmarked),
    isSubscribed: bool(body.isSubscribed),
    hasSeen: bool(body.hasSeen),
    isPublic: bool(body.isPublic),
    project: normalizeProjectSummary(body.project),
    assignedTo: normalizeIssueActor(body.assignedTo),
    statusDetails: normalizeIssueStatusDetails(body.statusDetails),
    metadata: body.metadata ?? null,
    stats: body.stats ?? null,
    tags: normalizeIssueTags(body.tags),
  }
}

function normalizeEventUser(value: unknown): Json | null {
  const body = record(value)
  if (body === undefined) return null
  return {
    id: nullableStr(body.id),
    email: nullableStr(body.email),
    username: nullableStr(body.username),
    ipAddress: nullableStr(body.ipAddress ?? body.ip_address ?? body.ip),
    name: nullableStr(body.name),
  }
}

/** event 的 tags:`key` 与 `value` 都得有,少一个整条丢掉。 */
function normalizeEventTags(value: unknown): Json[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((item) => {
    const body = record(item)
    if (body === undefined || !nonEmpty(body.key) || !nonEmpty(body.value)) return []
    return [{ key: body.key, value: body.value }]
  })
}

function normalizeIssueEvent(value: unknown): Json {
  const body = expectRecord(value, 'issue event')
  return {
    // Sentry 的事件 id 在列表与详情上分别叫 `id` 与 `eventID`,两种都收。
    id: str(body.id) ?? str(body.eventID) ?? '',
    eventId: nullableStr(body.eventID ?? body.eventId),
    issueId: nullableStr(body.groupID ?? body.groupId),
    title: nullableStr(body.title),
    message: nullableStr(body.message),
    platform: nullableStr(body.platform),
    dateCreated: nullableStr(body.dateCreated),
    user: normalizeEventUser(body.user),
    tags: normalizeEventTags(body.tags),
  }
}

function normalizeReleaseProjects(value: unknown): Json[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((item) => {
    const body = record(item)
    if (body === undefined) return []
    return [{ id: nullableInt(body.id), slug: nullableStr(body.slug), name: nullableStr(body.name) }]
  })
}

function normalizeRelease(value: unknown): Json {
  const body = expectRecord(value, 'release')
  return {
    version: str(body.version) ?? '',
    shortVersion: nullableStr(body.shortVersion),
    status: nullableStr(body.status),
    dateCreated: nullableStr(body.dateCreated),
    dateReleased: nullableStr(body.dateReleased),
    ref: nullableStr(body.ref),
    url: nullableStr(body.url),
    newGroups: nullableInt(body.newGroups),
    projects: normalizeReleaseProjects(body.projects),
    lastCommit: body.lastCommit ?? body.last_commit ?? null,
    lastDeploy: body.lastDeploy ?? body.last_deploy ?? null,
    healthData: body.healthData ?? body.health_data ?? null,
    stats: body.stats ?? null,
  }
}

function normalizeHealthGroups(value: unknown): Json[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((item) => {
    const body = record(item)
    if (body === undefined) return []
    return [{ by: record(body.by) ?? {}, totals: record(body.totals) ?? {}, series: record(body.series) ?? null }]
  })
}

function normalizeReplayUser(value: unknown): Json | null {
  const body = record(value)
  if (body === undefined) return null
  return {
    id: nullableStr(body.id),
    email: nullableStr(body.email),
    username: nullableStr(body.username),
    ip: nullableStr(body.ip ?? body.ipAddress ?? body.ip_address),
  }
}

function normalizeNamedValue(value: unknown): Json | null {
  const body = record(value)
  if (body === undefined) return null
  return { name: nullableStr(body.name), version: nullableStr(body.version) }
}

/** replay 的 releases 既可能是版本号字符串数组,也可能是 `{version}` 对象数组。 */
function normalizeReplayReleases(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((item) => {
    if (typeof item === 'string') return [item]
    const version = str(record(item)?.version)
    return version === undefined ? [] : [version]
  })
}

function normalizeReplay(value: unknown): Json {
  const body = expectRecord(value, 'replay')
  return {
    id: str(body.id) ?? '',
    projectId: nullableInt(body.projectId ?? body.project_id),
    environment: nullableStr(body.environment),
    platform: nullableStr(body.platform),
    startedAt: nullableStr(body.startedAt ?? body.started_at),
    finishedAt: nullableStr(body.finishedAt ?? body.finished_at),
    duration: nullableInt(body.duration),
    countErrors: nullableInt(body.countErrors ?? body.count_errors),
    countRageClicks: nullableInt(body.countRageClicks ?? body.count_rage_clicks),
    countDeadClicks: nullableInt(body.countDeadClicks ?? body.count_dead_clicks),
    countSegments: nullableInt(body.countSegments ?? body.count_segments),
    user: normalizeReplayUser(body.user),
    browser: normalizeNamedValue(body.browser),
    os: normalizeNamedValue(body.os),
    device: normalizeNamedValue(body.device),
    releases: normalizeReplayReleases(body.releases),
  }
}

/** `createdBy` 既可能是裸字符串,也可能是个 actor 对象(取 id/email/username 之一)。 */
function normalizeCreatedBy(value: unknown): string | null {
  if (typeof value === 'string') return value
  const body = record(value)
  if (body === undefined) return null
  return nullableStr(body.id ?? body.email ?? body.username)
}

function normalizeAlertTrigger(value: unknown): Json | null {
  const body = record(value)
  if (body === undefined) return null
  return {
    id: nullableStr(body.id),
    logicType: nullableStr(body.logicType),
    actions: body.actions ?? null,
    conditions: body.conditions ?? null,
    organizationId: nullableStr(body.organizationId ?? body.organization_id),
  }
}

function normalizeAlertActionFilters(value: unknown): Json[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((item) => {
    const body = record(item)
    if (body === undefined) return []
    return [{
      id: nullableStr(body.id),
      actions: body.actions ?? null,
      logicType: nullableStr(body.logicType),
      conditions: body.conditions ?? null,
      organizationId: nullableStr(body.organizationId ?? body.organization_id),
    }]
  })
}

function normalizeAlert(value: unknown): Json {
  const body = expectRecord(value, 'alert')
  return {
    id: str(body.id) ?? '',
    name: str(body.name) ?? '',
    organizationId: nullableStr(body.organizationId ?? body.organization_id),
    enabled: bool(body.enabled),
    createdBy: normalizeCreatedBy(body.createdBy),
    dateCreated: nullableStr(body.dateCreated),
    dateUpdated: nullableStr(body.dateUpdated),
    environment: nullableStr(body.environment),
    lastTriggered: nullableStr(body.lastTriggered),
    detectorIds: strArray(body.detectorIds),
    config: record(body.config) ?? {},
    triggers: normalizeAlertTrigger(body.triggers),
    actionFilters: normalizeAlertActionFilters(body.actionFilters),
  }
}

/** workflows 端点:裸数组或 `{data: [...]}` 信封都要认(上游 `unwrapSentryWorkflowList`)。 */
function unwrapWorkflowList(payload: unknown): unknown[] {
  if (Array.isArray(payload)) return payload
  const body = record(payload)
  if (body === undefined || !Array.isArray(body.data)) {
    throw new TBError('unavailable', 'Sentry alerts 响应形状不符', { retryable: true })
  }
  return body.data
}

/** 单个 workflow 也可能被 `{data: {...}}` 包一层。 */
function unwrapWorkflowItem(payload: unknown): unknown {
  const body = record(payload)
  return body !== undefined && 'data' in body ? body.data : payload
}

/** 路径段一律转义:org slug 与 release version 都可能带 `/`。 */
function seg(value: string): string {
  return encodeURIComponent(value)
}

// ---- action handlers ----

export async function listOrganizationIntegrations(
  input: z.infer<typeof listOrganizationIntegrationsInput>,
  ctx: ProviderContext,
): Promise<Json> {
  const { payload } = await request(ctx, `organizations/${seg(input.organizationIdOrSlug)}/integrations/`, {
    query: compact({
      providerKey: input.providerKey,
      includeConfig: input.includeConfig,
      features: input.features,
    }) as Record<string, QueryValue>,
  })
  return { integrations: expectArray(payload, 'integrations').map(normalizeOrganizationIntegration) }
}

export async function getOrganizationIntegration(
  input: z.infer<typeof getOrganizationIntegrationInput>,
  ctx: ProviderContext,
): Promise<Json> {
  const path = `organizations/${seg(input.organizationIdOrSlug)}/integrations/${seg(input.integrationId)}/`
  const { payload } = await request(ctx, path)
  return { integration: normalizeOrganizationIntegration(payload) }
}

export async function getOrganizationIntegrationConfig(
  input: z.infer<typeof getOrganizationIntegrationConfigInput>,
  ctx: ProviderContext,
): Promise<Json> {
  const { payload } = await request(ctx, `organizations/${seg(input.organizationIdOrSlug)}/config/integrations/`, {
    query: { providerKey: input.providerKey },
  })
  const body = expectRecord(payload, 'integration config')
  if (!Array.isArray(body.providers)) {
    throw new TBError('unavailable', 'Sentry integration config 响应缺 providers', { retryable: true })
  }
  return { providers: body.providers.map(normalizeIntegrationProvider) }
}

export async function listOrganizationSentryApps(
  input: z.infer<typeof listOrganizationSentryAppsInput>,
  ctx: ProviderContext,
): Promise<Json> {
  const { payload } = await request(ctx, `organizations/${seg(input.organizationIdOrSlug)}/sentry-apps/`)
  return { sentryApps: expectArray(payload, 'apps').map(normalizeSentryApp) }
}

export async function getSentryApp(
  input: z.infer<typeof getSentryAppInput>,
  ctx: ProviderContext,
): Promise<Json> {
  const { payload } = await request(ctx, `sentry-apps/${seg(input.sentryAppIdOrSlug)}/`)
  return { sentryApp: normalizeSentryApp(payload) }
}

export async function listOrganizationProjects(
  input: z.infer<typeof listOrganizationProjectsInput>,
  ctx: ProviderContext,
): Promise<Json> {
  const { payload, headers } = await request(ctx, `organizations/${seg(input.organizationIdOrSlug)}/projects/`, {
    query: { cursor: input.cursor },
  })
  return {
    projects: expectArray(payload, 'projects').map(normalizeProject),
    ...cursors(headers),
  }
}

export async function getProject(input: z.infer<typeof getProjectInput>, ctx: ProviderContext): Promise<Json> {
  // 注意端点是 `projects/{org}/{project}/`,不是 `organizations/{org}/projects/{project}/`。
  const { payload } = await request(ctx, `projects/${seg(input.organizationIdOrSlug)}/${seg(input.projectIdOrSlug)}/`)
  return { project: normalizeProject(payload) }
}

export async function listOrganizationIssues(
  input: z.infer<typeof listOrganizationIssuesInput>,
  ctx: ProviderContext,
): Promise<Json> {
  const { payload, headers } = await request(ctx, `organizations/${seg(input.organizationIdOrSlug)}/issues/`, {
    query: {
      query: input.query,
      sort: input.sort,
      limit: input.limit,
      start: input.start,
      end: input.end,
      cursor: input.cursor,
      expand: input.expand,
      collapse: input.collapse,
      // 入参名是复数 `environments` / `projectIds`,线上是单数 `environment` / `project`。
      environment: input.environments,
      project: input.projectIds,
      statsPeriod: input.statsPeriod,
      // Sentry 这个参数只认 1/0,给 true/false 会被当成"没传"。
      shortIdLookup: oneZero(input.shortIdLookup),
      groupStatsPeriod: input.groupStatsPeriod,
      viewId: input.viewId,
    },
  })
  return {
    issues: expectArray(payload, 'issues').map(normalizeIssue),
    ...cursors(headers),
  }
}

export async function getIssue(input: z.infer<typeof getIssueInput>, ctx: ProviderContext): Promise<Json> {
  const path = `organizations/${seg(input.organizationIdOrSlug)}/issues/${seg(input.issueId)}/`
  const { payload } = await request(ctx, path)
  return { issue: normalizeIssue(payload) }
}

export async function getIssueEvent(input: z.infer<typeof getIssueEventInput>, ctx: ProviderContext): Promise<Json> {
  const path = `organizations/${seg(input.organizationIdOrSlug)}/issues/${seg(input.issueId)}`
    + `/events/${seg(input.eventId)}/`
  const { payload } = await request(ctx, path, { query: { environment: input.environments } })
  return { event: normalizeIssueEvent(payload) }
}

export async function listIssueEvents(
  input: z.infer<typeof listIssueEventsInput>,
  ctx: ProviderContext,
): Promise<Json> {
  const path = `organizations/${seg(input.organizationIdOrSlug)}/issues/${seg(input.issueId)}/events/`
  const { payload } = await request(ctx, path, {
    query: {
      full: input.full,
      sample: input.sample,
      query: input.query,
      start: input.start,
      end: input.end,
      environment: input.environments,
      statsPeriod: input.statsPeriod,
    },
  })
  return { events: expectArray(payload, 'issue events').map(normalizeIssueEvent) }
}

export async function updateIssue(input: z.infer<typeof updateIssueInput>, ctx: ProviderContext): Promise<Json> {
  const details = input.statusDetails === undefined ? undefined : compact({ ...input.statusDetails })
  const { payload } = await request(ctx, `organizations/${seg(input.organizationIdOrSlug)}/issues/${seg(input.issueId)}/`, {
    method: 'PUT',
    body: compact({
      status: input.status,
      hasSeen: input.hasSeen,
      isPublic: input.isPublic,
      // 空串是**取消指派**的正规写法(不是"没给值"),故这里不能用 `text()` 过滤掉它。
      assignedTo: input.assignedTo,
      isBookmarked: input.isBookmarked,
      isSubscribed: input.isSubscribed,
      statusDetails: details,
    }),
  })
  return { issue: normalizeIssue(payload) }
}

export async function listOrganizationReleases(
  input: z.infer<typeof listOrganizationReleasesInput>,
  ctx: ProviderContext,
): Promise<Json> {
  const { payload } = await request(ctx, `organizations/${seg(input.organizationIdOrSlug)}/releases/`, {
    query: { query: input.query },
  })
  return { releases: expectArray(payload, 'releases').map(normalizeRelease) }
}

export async function getOrganizationRelease(
  input: z.infer<typeof getOrganizationReleaseInput>,
  ctx: ProviderContext,
): Promise<Json> {
  const path = `organizations/${seg(input.organizationIdOrSlug)}/releases/${seg(input.version)}/`
  const { payload } = await request(ctx, path, {
    query: compact({
      sort: input.sort,
      query: input.query,
      health: input.health,
      status: input.status,
      // 入参叫 projectId,线上参数名是 project。
      project: input.projectId,
      adoptionStages: input.adoptionStages,
      healthStatsPeriod: input.healthStatsPeriod,
      summaryStatsPeriod: input.summaryStatsPeriod,
    }) as Record<string, QueryValue>,
  })
  return { release: normalizeRelease(payload) }
}

export async function getReleaseHealthStats(
  input: z.infer<typeof getReleaseHealthStatsInput>,
  ctx: ProviderContext,
): Promise<Json> {
  // version 不进路径:这个 action 打的是 sessions 端点,版本号是一条**搜索子句**。
  const { payload } = await request(ctx, `organizations/${seg(input.organizationIdOrSlug)}/sessions/`, {
    query: {
      field: input.fields,
      groupBy: input.groupBy,
      query: joinClauses(`release:${input.version}`, input.query),
      start: input.start,
      end: input.end,
      environment: input.environments,
      project: input.projectIds,
      interval: input.interval,
      statsPeriod: input.statsPeriod,
      includeSeries: input.includeSeries,
      includeTotals: input.includeTotals,
      // 这一个是 snake_case,同一个端点上与 camelCase 参数混着用。
      per_page: input.perPage,
      orderBy: input.orderBy,
    },
  })
  const body = expectRecord(payload, 'release health stats')
  return {
    groups: normalizeHealthGroups(body.groups),
    intervals: strArray(body.intervals),
    start: nullableStr(body.start),
    end: nullableStr(body.end),
  }
}

export async function listOrganizationReplays(
  input: z.infer<typeof listOrganizationReplaysInput>,
  ctx: ProviderContext,
): Promise<Json> {
  const { payload, headers } = await request(ctx, `organizations/${seg(input.organizationIdOrSlug)}/replays/`, {
    query: {
      start: input.start,
      end: input.end,
      sort: input.sort,
      field: input.field,
      query: input.query,
      cursor: input.cursor,
      project: input.projectIds,
      per_page: input.perPage,
      environment: input.environment,
      statsPeriod: input.statsPeriod,
    },
  })
  return {
    replays: expectArray(payload, 'replays').map(normalizeReplay),
    ...cursors(headers),
  }
}

export async function getReplay(input: z.infer<typeof getReplayInput>, ctx: ProviderContext): Promise<Json> {
  const path = `organizations/${seg(input.organizationIdOrSlug)}/replays/${seg(input.replayId)}/`
  const { payload, headers } = await request(ctx, path, {
    query: {
      start: input.start,
      end: input.end,
      sort: input.sort,
      field: input.field,
      query: input.query,
      cursor: input.cursor,
      project: input.projectIds,
      per_page: input.perPage,
      environment: input.environment,
      statsPeriod: input.statsPeriod,
    },
  })
  // 详情端点也带 Link 头(内嵌数据的分页),照上游一并透出。
  return { replay: normalizeReplay(payload), ...cursors(headers) }
}

export async function listAlerts(input: z.infer<typeof listAlertsInput>, ctx: ProviderContext): Promise<Json> {
  const { payload } = await request(ctx, `organizations/${seg(input.organizationIdOrSlug)}/workflows/`, {
    query: {
      // 入参叫 ids,线上参数名是单数 id(可重复)。
      id: input.ids,
      query: input.query,
      sortBy: input.sortBy,
      project: input.projectIds,
    },
  })
  return { alerts: unwrapWorkflowList(payload).map(normalizeAlert) }
}

export async function getAlert(input: z.infer<typeof getAlertInput>, ctx: ProviderContext): Promise<Json> {
  const path = `organizations/${seg(input.organizationIdOrSlug)}/workflows/${seg(input.alertId)}/`
  const { payload } = await request(ctx, path)
  return { alert: normalizeAlert(unwrapWorkflowItem(payload)) }
}
