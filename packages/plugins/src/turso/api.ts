/**
 * Turso Platform API 的业务逻辑。
 *
 * 迁移自 open-connector `src/providers/turso/runtime.ts`,语义等价、写法本地化:
 * 凭证从 `ctx.upstreamAuth` 取(平台经 authRef 注入,插件不自持),出站走 `guardedFetch`,
 * 错误抛 `TBError` 七码。
 *
 * 凭证走 **header**(`authorization: Bearer <platform token>`),不进 URL。
 *
 * 三处上游细节决定了这里的形状:
 * - **响应外层的键名不稳定**:同一个列表接口既可能直接回数组、也可能包在 `{groups: [...]}`、
 *   `{data: [...]}` 里,`list_locations` 还会用 `regions` 而不是 `locations`。上游为此按
 *   一串候选键去找,找不到就报错;这层照抄,不敢猜。
 * - **出参是"选定 8 个字段 + 原样 `raw`"的双份结构**:归一后的字段方便 agent 直接用,
 *   `raw` 保住上游后加的字段不丢。8 个字段按 `optionalString` 去空白取,空的整键丢掉。
 * - **`extensions` 有两种形态**:`'all'` 或显式名字数组。数组要逐项去空白 —— Zod 的
 *   `min(1)` 拦不住纯空白串。
 * - 路径段(organizationSlug / name)全部 `encodeURIComponent`,不让斜杠越出资源边界。
 *
 * 与上游的有意偏离:
 * - 上游 `createTursoError` 把 404/409/422 一律压成 400。这里把原始状态交给
 *   `upstreamError`(404 仍是 not_found、409 仍是 conflict),收敛各 provider 互不相同的
 *   错误口径正是 `_runtime/upstreamError.ts` 存在的理由 —— "库不存在"与"参数写错"对
 *   调用方是两种要采取不同动作的结果。
 * - 上游的 `phase: 'validate'` 分支只服务 `validateTursoCredential`(把 401/403 说成 400)。
 *   平台侧的 credentialProbe 自己做这层分账,故不迁。
 * - 不发 `user-agent`:上游那个值标识的是 open-connector 进程,在这里已无意义。
 * - 上游按 `AbortError`/超时把传输失败分成 504/502;本地没有 signal 可传,那条分支
 *   不可达,故只保留 502。
 */

import type { z } from 'zod/v4'
import { TBError } from '@tool-bridge/plugin-sdk'
import type {
  createDatabaseInput,
  createGroupInput,
  deleteDatabaseInput,
  getDatabaseInput,
  getGroupInput,
  getOrganizationInput,
  listDatabasesInput,
  listGroupsInput,
  listLocationsInput,
  listOrganizationsInput,
} from './schema'
import { type ProviderContext, requireApiKey } from '../_runtime/plugin'
import { upstreamError } from '../_runtime/upstreamError'
import { guardedFetch } from '../_runtime/guardedFetch'

const SERVICE = 'turso'
const API_BASE = 'https://api.turso.tech'

type Json = Record<string, unknown>
type Method = 'DELETE' | 'GET' | 'POST'

function record(value: unknown): Json | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Json) : undefined
}

/** 上游 `optionalString` 的等价物:去空白后仍非空才算有值。 */
function text(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  return trimmed === '' ? undefined : trimmed
}

/** 上游 `readInputString`:schema 的 `min(1)` 放过纯空白串,必填断言落在这层。 */
function requireText(value: unknown, field: string): string {
  const result = text(value)
  if (result === undefined) throw new TBError('invalid_argument', `${field} is required.`)
  return result
}

/** 丢掉值为 undefined 的键(上游 `compactObject`)。 */
function compact(input: Json): Json {
  return Object.fromEntries(Object.entries(input).filter(([, value]) => value !== undefined))
}

/** 上游回的形状不符合契约 —— 是上游的问题,不是调用方的错。 */
function responseError(message: string): TBError {
  return new TBError('unavailable', message, { retryable: true })
}

/**
 * 归一一个 Turso 资源:挑出 8 个跨资源通用的字段,再把原始对象整个挂在 `raw` 上。
 * `raw` 不能省 —— 归一表是有意收窄的,上游给的其余字段(计费、副本、时间戳)只在这里。
 */
function normalizeResource(raw: Json): Json {
  return compact({
    slug: text(raw.slug),
    name: text(raw.name),
    type: text(raw.type),
    location: text(raw.location),
    uuid: text(raw.uuid),
    group: text(raw.group),
    hostname: text(raw.hostname),
    code: text(raw.code),
    raw,
  })
}

/** 逐项归一;非对象项静默丢弃(上游同样的取舍:一条坏数据不该让整次列举失败)。 */
function normalizeItems(items: unknown[]): Json[] {
  return items.flatMap((item) => {
    const fields = record(item)
    return fields === undefined ? [] : [normalizeResource(fields)]
  })
}

/**
 * 从列表响应里取出资源数组。
 *
 * Turso 在不同接口上用不同的外层键(`groups` / `locations` / `regions` / `data`),也可能
 * 直接回一个裸数组。候选键按上游给的顺序找,`data` 总是最后的退路;一个都不命中就报
 * unavailable —— 静默回空数组会让 agent 以为"这个组织真的没有库"。
 */
function resourceList(payload: unknown, keys: string[]): Json[] {
  if (Array.isArray(payload)) return normalizeItems(payload)
  const fields = record(payload)
  if (fields === undefined) throw responseError('Turso returned an invalid list response')
  for (const key of [...keys, 'data']) {
    const value = fields[key]
    if (Array.isArray(value)) return normalizeItems(value)
  }
  throw responseError('Turso list response is missing items')
}

/**
 * 从单资源响应里取出资源对象。候选键都不命中时**把整个响应体当资源** —— Turso 的
 * 部分接口不包外层信封,上游这条兜底不能省。
 */
function singleResource(payload: unknown, keys: string[]): Json {
  const fields = record(payload)
  if (fields === undefined) throw responseError('Turso returned an invalid resource response')
  for (const key of [...keys, 'data']) {
    const value = record(fields[key])
    if (value !== undefined) return normalizeResource(value)
  }
  return normalizeResource(fields)
}

/** 空体(DELETE 常见)按 `{}` 处理;非 JSON 体退化成 `{message: <原文>}` 好让错误分支拿到消息。 */
function readPayload(body: string): unknown {
  if (body.trim() === '') return {}
  try {
    return JSON.parse(body)
  } catch {
    return { message: body }
  }
}

/** Turso 的错误消息散落在五六个键里,按上游的顺序找。 */
function errorMessage(payload: unknown, status: number): string {
  const direct = text(payload)
  if (direct !== undefined) return direct
  const fields = record(payload)
  const nested = record(fields?.error)
  const message = text(fields?.message)
    ?? text(fields?.error)
    ?? text(fields?.detail)
    ?? text(fields?.title)
    ?? text(nested?.message)
    ?? text(nested?.detail)
  return message ?? `Turso request failed with ${status}`
}

interface RequestInput {
  body?: Json
  method: Method
  path: string
}

async function request(ctx: ProviderContext, input: RequestInput): Promise<unknown> {
  // 取凭证放在 try 外:它抛的是配置错误,不该被下面的传输失败兜底吞成 502。
  const apiKey = requireApiKey(ctx, SERVICE)

  let response: Response
  let payload: unknown
  try {
    response = await guardedFetch(`${API_BASE}${input.path}`, {
      method: input.method,
      headers: {
        accept: 'application/json',
        authorization: `Bearer ${apiKey}`,
        ...(input.body === undefined ? {} : { 'content-type': 'application/json' }),
      },
      body: input.body === undefined ? undefined : JSON.stringify(input.body),
    })
    payload = readPayload(await response.text())
  } catch (error) {
    // 传输层失败必须就地归一:漏出去的裸 Error 会被 plugin-sdk 抹成 "internal plugin error"
    // 500。EgressBlockedError 本身是 TBError(invalid_argument),原样冒上去。
    if (error instanceof TBError) throw error
    throw upstreamError(502, error instanceof Error ? `Turso request failed: ${error.message}` : 'Turso request failed')
  }

  if (!response.ok) throw upstreamError(response.status, errorMessage(payload, response.status))
  return payload
}

/** 组织下的资源路径前缀;slug 进路径故必须 encode。 */
function organizationPath(organizationSlug: unknown): string {
  return `/v1/organizations/${encodeURIComponent(requireText(organizationSlug, 'organizationSlug'))}`
}

/** `extensions` 的两种形态:`'all'` 原样发;数组逐项去空白(Zod 的 min(1) 放过纯空白串)。 */
function extensions(value: 'all' | string[] | undefined): string | string[] | undefined {
  if (value === undefined || value === 'all') return value
  return value.map(item => requireText(item, 'extensions'))
}

export async function listOrganizations(
  _input: z.infer<typeof listOrganizationsInput>,
  ctx: ProviderContext,
): Promise<Json> {
  const payload = await request(ctx, { method: 'GET', path: '/v1/organizations' })
  return { organizations: resourceList(payload, ['organizations']) }
}

export async function getOrganization(
  input: z.infer<typeof getOrganizationInput>,
  ctx: ProviderContext,
): Promise<Json> {
  const payload = await request(ctx, { method: 'GET', path: organizationPath(input.organizationSlug) })
  return { organization: singleResource(payload, ['organization']) }
}

export async function listLocations(
  _input: z.infer<typeof listLocationsInput>,
  ctx: ProviderContext,
): Promise<Json> {
  const payload = await request(ctx, { method: 'GET', path: '/v1/locations' })
  // `regions` 是上游为 Turso 早期响应留的别名,两个键都得认。
  return { locations: resourceList(payload, ['locations', 'regions']) }
}

export async function listGroups(input: z.infer<typeof listGroupsInput>, ctx: ProviderContext): Promise<Json> {
  const payload = await request(ctx, { method: 'GET', path: `${organizationPath(input.organizationSlug)}/groups` })
  return { groups: resourceList(payload, ['groups']) }
}

export async function getGroup(input: z.infer<typeof getGroupInput>, ctx: ProviderContext): Promise<Json> {
  const name = encodeURIComponent(requireText(input.name, 'name'))
  const payload = await request(ctx, {
    method: 'GET',
    path: `${organizationPath(input.organizationSlug)}/groups/${name}`,
  })
  return { group: singleResource(payload, ['group']) }
}

export async function createGroup(input: z.infer<typeof createGroupInput>, ctx: ProviderContext): Promise<Json> {
  const payload = await request(ctx, {
    method: 'POST',
    path: `${organizationPath(input.organizationSlug)}/groups`,
    body: compact({
      name: requireText(input.name, 'name'),
      location: requireText(input.location, 'location'),
      extensions: extensions(input.extensions),
    }),
  })
  return { group: singleResource(payload, ['group']) }
}

export async function listDatabases(input: z.infer<typeof listDatabasesInput>, ctx: ProviderContext): Promise<Json> {
  const payload = await request(ctx, { method: 'GET', path: `${organizationPath(input.organizationSlug)}/databases` })
  return { databases: resourceList(payload, ['databases']) }
}

export async function getDatabase(input: z.infer<typeof getDatabaseInput>, ctx: ProviderContext): Promise<Json> {
  const name = encodeURIComponent(requireText(input.name, 'name'))
  const payload = await request(ctx, {
    method: 'GET',
    path: `${organizationPath(input.organizationSlug)}/databases/${name}`,
  })
  return { database: singleResource(payload, ['database']) }
}

export async function createDatabase(input: z.infer<typeof createDatabaseInput>, ctx: ProviderContext): Promise<Json> {
  const payload = await request(ctx, {
    method: 'POST',
    path: `${organizationPath(input.organizationSlug)}/databases`,
    // 上游这里没走 compactObject:两个字段都是必填,给不出就该在断言处炸。
    body: {
      name: requireText(input.name, 'name'),
      group: requireText(input.group, 'group'),
    },
  })
  return { database: singleResource(payload, ['database']) }
}

export async function deleteDatabase(input: z.infer<typeof deleteDatabaseInput>, ctx: ProviderContext): Promise<Json> {
  const name = encodeURIComponent(requireText(input.name, 'name'))
  await request(ctx, {
    method: 'DELETE',
    path: `${organizationPath(input.organizationSlug)}/databases/${name}`,
  })
  // 上游丢掉删除响应体(Turso 只回一个库名),固定回 `{deleted:true}`;出参 schema 也这么声明。
  return { deleted: true }
}
