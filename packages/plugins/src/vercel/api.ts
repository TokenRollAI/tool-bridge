/**
 * Vercel 的业务逻辑。
 *
 * 迁移自 open-connector `src/providers/vercel/runtime.ts`,语义等价、写法本地化:
 * 凭证从 `ctx.upstreamAuth` 取(平台经 authRef 注入),出站走 `guardedFetch`,错误抛
 * `TBError` 七码。凭证在 **header**(`Authorization: Bearer <access token>`),不在 URL 上。
 *
 * 五处上游细节决定了这里的形状:
 * - **每个 action 的 API 版本号都不一样**,而且同一资源的不同动作也不同:列项目是
 *   `/v10/projects`、取单个是 `/v9/projects/{id}`、建项目是 `/v11/projects`;域名列表在
 *   `/v9/…/domains` 而新增在 `/v10/…/domains`。这不是笔误,是 Vercel 各端点独立演进的结果,
 *   照抄即可 —— 统一成一个版本号会 404 或行为漂移。全部版本号在下面 `ACTION` 各处标出。
 * - `/v2/user` 与 `/v2/teams/{id}` 的响应**可能带包装也可能不带**(`{user:{…}}` 或直接是
 *   user 对象)。上游用 `payload.user ?? payload` 两种都接,这层保留(见 `unwrap`)。
 * - **两种布尔 query 编码并存**:`get_deployment_events` 的 `builds` 走上游 `queryFlag`,发
 *   `1`/`0`;`get_deployment` 的 `withGitRepoInfo` 直接 `String(boolean)`,发 `true`/`false`。
 *   看着像不一致,但那是两个端点各自的约定。
 * - 出参是**裁剪**过的:每个资源只透出声明里的字段(`mapProject`/`mapDeployment`/…),
 *   `undefined` 的键整个丢掉,`null` 留住(`domain.redirect` 的 null 是"没设重定向"的明确表态)。
 * - `create_project_env` / `update_project_env` 有一条**本地前置校验**:
 *   `type: 'sensitive'` 不能带 `development` target。上游在打网络之前就拒,这层保留 ——
 *   否则是一次必然失败的写请求(见 `rejectSensitiveDevelopmentConflict`)。
 *
 * 与上游的两处有意偏离,理由写在各自注释里:错误码归一走共用表(上游把 404/409 压成 400)、
 * 出参契约字段缺失归 `unavailable` 而不是 `invalid_argument`。
 */

import type { z } from 'zod/v4'
import { TBError } from '@tool-bridge/plugin-sdk'
import type {
  addProjectDomainInput,
  createProjectEnvInput,
  createProjectInput,
  createWebhookInput,
  deleteProjectEnvInput,
  getAuthUserInput,
  getDeploymentEventsInput,
  getDeploymentInput,
  getDomainConfigInput,
  getProjectDomainInput,
  getProjectInput,
  getRuntimeLogsInput,
  getTeamInput,
  getWebhookInput,
  listDeploymentsInput,
  listProjectDomainsInput,
  listProjectEnvsInput,
  listProjectsInput,
  listTeamsInput,
  listWebhooksInput,
  updateProjectEnvInput,
  updateProjectInput,
  verifyProjectDomainInput,
} from './schema'
import { type ProviderContext, requireApiKey } from '../_runtime/plugin'
import { upstreamError } from '../_runtime/upstreamError'
import { guardedFetch } from '../_runtime/guardedFetch'

const SERVICE = 'vercel'
const API_BASE = 'https://api.vercel.com'

type Json = Record<string, unknown>
type QueryValue = boolean | number | string | undefined

interface RequestInput {
  body?: Json
  method?: 'DELETE' | 'GET' | 'PATCH' | 'POST'
  path: string
  query?: Record<string, QueryValue>
}

/** 上游 `optionalString`:去空白后仍非空才算有值。 */
function text(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  return trimmed === '' ? undefined : trimmed
}

/** 上游 `optionalNumber`:必须已经是有限数字,不做字符串解析。 */
function num(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function bool(value: unknown): boolean | undefined {
  return typeof value === 'boolean' ? value : undefined
}

function record(value: unknown): Json | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Json) : undefined
}

/** 丢掉值为 undefined 的键(上游 `compactObject` / `jsonObject`);`null` 与 `0` 留住。 */
function compact<T>(input: Record<string, T | undefined>): Record<string, T> {
  return Object.fromEntries(
    Object.entries(input).filter(([, value]) => value !== undefined),
  ) as Record<string, T>
}

/** 上游 `normalizeStringArray`:只保留已经是字符串的项;不是数组则整个字段不透出。 */
function stringArray(value: unknown): string[] | undefined {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : undefined
}

/** 上游 `queryFlag`:true → '1',false → '0'。只有部分端点用这套编码。 */
function flag(value: boolean | undefined): string | undefined {
  return value === undefined ? undefined : value ? '1' : '0'
}

/**
 * 出参里契约声明为必填的字段缺失。
 *
 * **有意偏离上游**:上游对 `project.id` / `event.type` 这类**响应**字段用的是
 * `requireString`(400 → invalid_argument),等于把"Vercel 少给了一个字段"说成"调用方参数
 * 写错了" —— 调用方改不了任何东西,却收到一个不可重试的码。这里一律归 `unavailable` +
 * retryable(与 `requireNumber`/`requireObject` 的 502 一致)。
 */
function contractError(label: string): TBError {
  return new TBError('unavailable', `Vercel 响应缺少或类型不符:${label}`, { retryable: true })
}

function requiredText(value: unknown, label: string): string {
  const result = text(value)
  if (result === undefined) throw contractError(label)
  return result
}

function requiredNumber(value: unknown, label: string): number {
  const result = num(value)
  if (result === undefined) throw contractError(label)
  return result
}

function requiredRecord(value: unknown, label: string): Json {
  const result = record(value)
  if (result === undefined) throw contractError(label)
  return result
}

/** 上游 `normalizeArrayPayload`:载荷本身是数组就用它,否则取 `payload[key]`,再兜底成空数组。 */
function arrayPayload(payload: unknown, key: string): unknown[] {
  if (Array.isArray(payload)) return payload
  const value = record(payload)?.[key]
  return Array.isArray(value) ? value : []
}

/**
 * 发一次请求。
 *
 * **有意偏离上游**两处:
 * - 错误码走共用的 `upstreamError`。上游 `mapVercelError` 把 409 压成 400,并且每个 action
 *   自带一个 `notFoundAsInvalidInput` 开关把 404 也压成 400 —— 于是"项目名已被占用"、
 *   "项目不存在"、"参数非法"在调用方眼里是同一码。共用表把它们分开
 *   (409 → conflict,404 → not_found)。
 * - 2xx 上回非 JSON 归 `unavailable` + retryable(上游直接 `response.json()`,那个
 *   SyntaxError 冒到 plugin-sdk 会变成 internal 500,看起来像插件崩了)。空响应体记成 `{}`
 *   —— DELETE 环境变量这类接口可能什么都不回。
 */
async function request(ctx: ProviderContext, input: RequestInput): Promise<unknown> {
  const url = new URL(`${API_BASE}${input.path}`)
  for (const [key, value] of Object.entries(input.query ?? {})) {
    // 上游 `queryParams` 连空串一起跳过。
    if (value === undefined || value === '') continue
    url.searchParams.set(key, String(value))
  }

  const headers: Record<string, string> = {
    authorization: `Bearer ${requireApiKey(ctx, SERVICE)}`,
  }
  if (input.body !== undefined) headers['content-type'] = 'application/json'

  const response = await guardedFetch(url.toString(), {
    method: input.method ?? 'GET',
    headers,
    body: input.body === undefined ? undefined : JSON.stringify(input.body),
  })

  const raw = await response.text()
  let payload: unknown = {}
  let isJson = true
  if (raw !== '') {
    try {
      payload = JSON.parse(raw)
    } catch {
      isJson = false
    }
  }

  if (!response.ok) {
    // 错误体形如 `{ error: { code, message } }`,少数端点直接把 code/message 放在顶层。
    // 两者都拿不到时:JSON 体不回显原文(那是整个错误 body,可能带上游内部细节),
    // 非 JSON 体(HTML 错误页之类)才把原文当消息用 —— 这是上游 readVercelError 的兜底。
    const body = record(payload) ?? {}
    const error = record(body.error) ?? {}
    const message = text(error.message)
      ?? text(body.message)
      ?? (isJson ? undefined : text(raw))
      ?? `Vercel 返回 HTTP ${response.status}`
    throw upstreamError(response.status, message)
  }
  if (!isJson) throw new TBError('unavailable', 'Vercel 返回了非 JSON 响应', { retryable: true })
  return payload
}

/** `/v2/user` 与 `/v2/teams/{id}` 的响应可能带一层包装,也可能没有。 */
function unwrap(payload: unknown, key: 'team' | 'user'): Json {
  const body = requiredRecord(payload, key)
  return record(body[key]) ?? body
}

function mapUser(payload: unknown): Json {
  const user = unwrap(payload, 'user')
  return compact<unknown>({
    // 上游在 id 缺失时报 502:没有 id 的 user 响应不能算成功。
    id: requiredText(user.id, 'user.id'),
    username: text(user.username),
    email: text(user.email),
    name: text(user.name),
  })
}

function mapTeam(payload: unknown): Json {
  const team = unwrap(payload, 'team')
  return compact<unknown>({
    id: requiredText(team.id, 'team.id'),
    slug: text(team.slug),
    name: text(team.name),
    createdAt: num(team.createdAt),
    updatedAt: num(team.updatedAt),
  })
}

function mapDeployment(value: unknown): Json {
  const deployment = requiredRecord(value, 'deployment')
  return compact<unknown>({
    id: requiredText(deployment.id, 'deployment.id'),
    name: text(deployment.name),
    url: text(deployment.url),
    state: text(deployment.state),
    readyState: text(deployment.readyState),
    target: text(deployment.target),
    createdAt: num(deployment.createdAt),
    ready: num(deployment.ready),
    projectId: text(deployment.projectId),
    creator: record(deployment.creator),
    meta: record(deployment.meta),
    alias: stringArray(deployment.alias),
  })
}

function mapProject(value: unknown): Json {
  const project = requiredRecord(value, 'project')
  return compact<unknown>({
    id: requiredText(project.id, 'project.id'),
    name: requiredText(project.name, 'project.name'),
    accountId: text(project.accountId),
    framework: text(project.framework),
    nodeVersion: text(project.nodeVersion),
    createdAt: num(project.createdAt),
    updatedAt: num(project.updatedAt),
    link: record(project.link),
    latestDeployments: Array.isArray(project.latestDeployments)
      ? project.latestDeployments.map(deployment => mapDeployment(deployment))
      : undefined,
  })
}

function mapDeploymentEvent(value: unknown): Json {
  const event = requiredRecord(value, 'deployment event')
  return {
    created: requiredNumber(event.created, 'event.created'),
    type: requiredText(event.type, 'event.type'),
    payload: requiredRecord(event.payload, 'event.payload'),
  }
}

function mapRuntimeLog(value: unknown): Json {
  const log = requiredRecord(value, 'runtime log')
  return compact<unknown>({
    timestampInMs: requiredNumber(log.timestampInMs, 'log.timestampInMs'),
    level: requiredText(log.level, 'log.level'),
    message: requiredText(log.message, 'log.message'),
    source: requiredText(log.source, 'log.source'),
    requestMethod: text(log.requestMethod),
    requestPath: text(log.requestPath),
    responseStatusCode: num(log.responseStatusCode),
  })
}

function mapEnv(value: unknown): Json {
  const env = requiredRecord(value, 'env')
  return compact<unknown>({
    id: requiredText(env.id, 'env.id'),
    key: requiredText(env.key, 'env.key'),
    type: requiredText(env.type, 'env.type'),
    target: stringArray(env.target),
    gitBranch: text(env.gitBranch),
    createdAt: num(env.createdAt),
    updatedAt: num(env.updatedAt),
    comment: text(env.comment),
  })
}

function mapDomain(value: unknown): Json {
  const domain = requiredRecord(value, 'domain')
  return compact<unknown>({
    name: requiredText(domain.name, 'domain.name'),
    apexName: text(domain.apexName),
    verified: bool(domain.verified),
    verification: Array.isArray(domain.verification)
      ? domain.verification
          .map(item => record(item))
          .filter((item): item is Json => item !== undefined)
      : undefined,
    // null 是"明确没有重定向",与"字段缺席"不是一回事。
    redirect: domain.redirect === null ? null : text(domain.redirect),
    gitBranch: text(domain.gitBranch),
    customEnvironmentId: text(domain.customEnvironmentId),
  })
}

function mapWebhook(value: unknown): Json {
  const webhook = requiredRecord(value, 'webhook')
  return compact<unknown>({
    id: requiredText(webhook.id, 'webhook.id'),
    url: requiredText(webhook.url, 'webhook.url'),
    events: stringArray(webhook.events),
    projectIds: stringArray(webhook.projectIds),
    teamId: text(webhook.teamId),
    createdAt: num(webhook.createdAt),
    updatedAt: num(webhook.updatedAt),
  })
}

/** 分页信息原样透出(上游只做"是对象才带上")。 */
function pagination(payload: unknown): Json | undefined {
  return record(record(payload)?.pagination)
}

/** 项目相关的 body 字段表(create 与 update 共用同一组)。 */
function projectBody(input: {
  buildCommand?: string
  devCommand?: string
  directoryListing?: boolean
  framework?: string
  gitForkProtection?: boolean
  installCommand?: string
  name?: string
  nodeVersion?: string
  outputDirectory?: string
  publicSource?: boolean
  rootDirectory?: string
}): Json {
  return compact<unknown>({
    name: text(input.name),
    framework: text(input.framework),
    rootDirectory: text(input.rootDirectory),
    nodeVersion: text(input.nodeVersion),
    buildCommand: text(input.buildCommand),
    devCommand: text(input.devCommand),
    installCommand: text(input.installCommand),
    outputDirectory: text(input.outputDirectory),
    directoryListing: bool(input.directoryListing),
    publicSource: bool(input.publicSource),
    gitForkProtection: bool(input.gitForkProtection),
  })
}

/** 环境变量的 body 字段表(create 与 update 共用同一组)。 */
function envBody(input: {
  comment?: string
  customEnvironmentIds?: string[]
  gitBranch?: string
  key: string
  target: string[]
  type: string
  value: string
}): Json {
  return compact<unknown>({
    key: text(input.key),
    value: text(input.value),
    type: text(input.type),
    target: stringArray(input.target),
    gitBranch: text(input.gitBranch),
    comment: text(input.comment),
    customEnvironmentIds: stringArray(input.customEnvironmentIds),
  })
}

/**
 * `sensitive` 类型的环境变量不支持 `development` target。上游在**打网络之前**就拒 ——
 * 保留这条:否则是一次必然失败的写请求,而写请求的失败对调用方比读贵得多。
 */
function rejectSensitiveDevelopmentConflict(input: { target: string[], type: string }): void {
  if (input.type === 'sensitive' && input.target.includes('development')) {
    throw new TBError('invalid_argument', 'sensitive 类型的环境变量不支持 development target')
  }
}

/** 一个 URL 路径段。入参侧的必填由 schema 保证(这些字段都声明成了必填)。 */
function seg(value: string): string {
  return encodeURIComponent(value)
}

export async function getAuthUser(_input: z.infer<typeof getAuthUserInput>, ctx: ProviderContext): Promise<Json> {
  return { user: mapUser(await request(ctx, { path: '/v2/user' })) }
}

export async function listTeams(input: z.infer<typeof listTeamsInput>, ctx: ProviderContext): Promise<Json> {
  const payload = await request(ctx, {
    path: '/v2/teams',
    query: { limit: input.limit, since: input.since },
  })
  return compact<unknown>({
    teams: arrayPayload(payload, 'teams').map(team => mapTeam(team)),
    pagination: pagination(payload),
  })
}

export async function getTeam(input: z.infer<typeof getTeamInput>, ctx: ProviderContext): Promise<Json> {
  return { team: mapTeam(await request(ctx, { path: `/v2/teams/${seg(input.teamId)}` })) }
}

export async function listProjects(input: z.infer<typeof listProjectsInput>, ctx: ProviderContext): Promise<Json> {
  // 列项目在 v10。
  const payload = await request(ctx, {
    path: '/v10/projects',
    query: {
      limit: input.limit,
      since: input.since,
      until: input.until,
      repoUrl: text(input.repoUrl),
    },
  })
  return compact<unknown>({
    projects: arrayPayload(payload, 'projects').map(project => mapProject(project)),
    pagination: pagination(payload),
  })
}

export async function getProject(input: z.infer<typeof getProjectInput>, ctx: ProviderContext): Promise<Json> {
  // 取单个项目在 v9(列表却是 v10)。
  return { project: mapProject(await request(ctx, { path: `/v9/projects/${seg(input.idOrName)}` })) }
}

export async function createProject(input: z.infer<typeof createProjectInput>, ctx: ProviderContext): Promise<Json> {
  // 建项目在 v11。
  const payload = await request(ctx, {
    method: 'POST',
    path: '/v11/projects',
    body: projectBody(input),
  })
  return { project: mapProject(payload) }
}

export async function updateProject(input: z.infer<typeof updateProjectInput>, ctx: ProviderContext): Promise<Json> {
  const payload = await request(ctx, {
    method: 'PATCH',
    path: `/v9/projects/${seg(input.idOrName)}`,
    body: projectBody(input),
  })
  return { project: mapProject(payload) }
}

export async function listDeployments(
  input: z.infer<typeof listDeploymentsInput>,
  ctx: ProviderContext,
): Promise<Json> {
  const payload = await request(ctx, {
    path: '/v6/deployments',
    query: {
      limit: input.limit,
      projectId: text(input.projectId),
      since: input.since,
      until: input.until,
      target: text(input.target),
      state: text(input.state),
    },
  })
  return compact<unknown>({
    deployments: arrayPayload(payload, 'deployments').map(deployment => mapDeployment(deployment)),
    pagination: pagination(payload),
  })
}

export async function getDeployment(input: z.infer<typeof getDeploymentInput>, ctx: ProviderContext): Promise<Json> {
  const payload = await request(ctx, {
    path: `/v13/deployments/${seg(input.idOrUrl)}`,
    // 这个端点收 true/false 字面量,不是 1/0(见文件头)。
    query: { withGitRepoInfo: input.withGitRepoInfo },
  })
  return { deployment: mapDeployment(payload) }
}

export async function getDeploymentEvents(
  input: z.infer<typeof getDeploymentEventsInput>,
  ctx: ProviderContext,
): Promise<Json> {
  const payload = await request(ctx, {
    path: `/v3/deployments/${seg(input.idOrUrl)}/events`,
    query: {
      // 这个端点的布尔用 1/0 编码,与 get_deployment 不同。
      builds: flag(input.builds),
      direction: text(input.direction),
      limit: input.limit,
      since: input.since,
      until: input.until,
    },
  })
  // events 端点直接回数组(不带包装),故走 arrayPayload。
  return { events: arrayPayload(payload, 'events').map(event => mapDeploymentEvent(event)) }
}

export async function getRuntimeLogs(input: z.infer<typeof getRuntimeLogsInput>, ctx: ProviderContext): Promise<Json> {
  const payload = await request(ctx, {
    path: `/v1/projects/${seg(input.projectId)}/deployments/${seg(input.deploymentId)}/runtime-logs`,
  })
  return { logs: arrayPayload(payload, 'logs').map(log => mapRuntimeLog(log)) }
}

export async function listProjectEnvs(
  input: z.infer<typeof listProjectEnvsInput>,
  ctx: ProviderContext,
): Promise<Json> {
  const payload = await request(ctx, {
    path: `/v10/projects/${seg(input.idOrName)}/env`,
    query: {
      customEnvironmentId: text(input.customEnvironmentId),
      gitBranch: text(input.gitBranch),
    },
  })
  return { envs: arrayPayload(payload, 'envs').map(env => mapEnv(env)) }
}

export async function createProjectEnv(
  input: z.infer<typeof createProjectEnvInput>,
  ctx: ProviderContext,
): Promise<Json> {
  rejectSensitiveDevelopmentConflict(input)
  const payload = await request(ctx, {
    method: 'POST',
    path: `/v10/projects/${seg(input.idOrName)}/env`,
    body: envBody(input),
  })
  // 创建也回一个 envs 数组(Vercel 允许一次创建多个 target 的变体)。
  return { envs: arrayPayload(payload, 'envs').map(env => mapEnv(env)) }
}

export async function updateProjectEnv(
  input: z.infer<typeof updateProjectEnvInput>,
  ctx: ProviderContext,
): Promise<Json> {
  rejectSensitiveDevelopmentConflict(input)
  const payload = await request(ctx, {
    method: 'PATCH',
    path: `/v9/projects/${seg(input.idOrName)}/env/${seg(input.id)}`,
    body: envBody(input),
  })
  // 更新回单个 env 对象,不是数组。
  return { env: mapEnv(payload) }
}

export async function deleteProjectEnv(
  input: z.infer<typeof deleteProjectEnvInput>,
  ctx: ProviderContext,
): Promise<Json> {
  const payload = await request(ctx, {
    method: 'DELETE',
    path: `/v9/projects/${seg(input.idOrName)}/env/${seg(input.id)}`,
  })
  return { envs: arrayPayload(payload, 'envs').map(env => mapEnv(env)) }
}

export async function listProjectDomains(
  input: z.infer<typeof listProjectDomainsInput>,
  ctx: ProviderContext,
): Promise<Json> {
  const payload = await request(ctx, {
    path: `/v9/projects/${seg(input.idOrName)}/domains`,
    query: {
      limit: input.limit,
      since: input.since,
      until: input.until,
      gitBranch: text(input.gitBranch),
      customEnvironmentId: text(input.customEnvironmentId),
    },
  })
  return compact<unknown>({
    domains: arrayPayload(payload, 'domains').map(domain => mapDomain(domain)),
    pagination: pagination(payload),
  })
}

export async function getProjectDomain(
  input: z.infer<typeof getProjectDomainInput>,
  ctx: ProviderContext,
): Promise<Json> {
  const payload = await request(ctx, {
    path: `/v9/projects/${seg(input.idOrName)}/domains/${seg(input.domain)}`,
  })
  return { domain: mapDomain(payload) }
}

export async function addProjectDomain(
  input: z.infer<typeof addProjectDomainInput>,
  ctx: ProviderContext,
): Promise<Json> {
  // 新增域名在 v10(列表与取单个却在 v9)。
  const payload = await request(ctx, {
    method: 'POST',
    path: `/v10/projects/${seg(input.idOrName)}/domains`,
    body: compact<unknown>({
      name: text(input.name),
      redirect: text(input.redirect),
      gitBranch: text(input.gitBranch),
      customEnvironmentId: text(input.customEnvironmentId),
    }),
  })
  return { domain: mapDomain(payload) }
}

export async function verifyProjectDomain(
  input: z.infer<typeof verifyProjectDomainInput>,
  ctx: ProviderContext,
): Promise<Json> {
  // POST 但不带 body —— 也就不带 content-type(上游同样)。
  const payload = await request(ctx, {
    method: 'POST',
    path: `/v9/projects/${seg(input.idOrName)}/domains/${seg(input.domain)}/verify`,
  })
  return { domain: mapDomain(payload) }
}

export async function getDomainConfig(
  input: z.infer<typeof getDomainConfigInput>,
  ctx: ProviderContext,
): Promise<Json> {
  const payload = requiredRecord(
    await request(ctx, { path: `/v6/domains/${seg(input.domain)}/config` }),
    'domain config',
  )
  return compact<unknown>({
    configuredBy: text(payload.configuredBy),
    acceptedChallenges: stringArray(payload.acceptedChallenges),
    misconfigured: bool(payload.misconfigured),
    recommendedNameServers: stringArray(payload.recommendedNameServers),
  })
}

export async function listWebhooks(_input: z.infer<typeof listWebhooksInput>, ctx: ProviderContext): Promise<Json> {
  const payload = await request(ctx, { path: '/v1/webhooks' })
  return { webhooks: arrayPayload(payload, 'webhooks').map(webhook => mapWebhook(webhook)) }
}

export async function getWebhook(input: z.infer<typeof getWebhookInput>, ctx: ProviderContext): Promise<Json> {
  return { webhook: mapWebhook(await request(ctx, { path: `/v1/webhooks/${seg(input.id)}` })) }
}

export async function createWebhook(input: z.infer<typeof createWebhookInput>, ctx: ProviderContext): Promise<Json> {
  const payload = await request(ctx, {
    method: 'POST',
    path: '/v1/webhooks',
    body: compact<unknown>({
      url: text(input.url),
      events: stringArray(input.events),
      projectIds: stringArray(input.projectIds),
    }),
  })
  return { webhook: mapWebhook(payload) }
}
