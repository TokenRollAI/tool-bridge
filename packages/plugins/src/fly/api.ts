/**
 * Fly.io Machines API 的业务逻辑。
 *
 * 迁移自 open-connector `src/providers/fly/runtime.ts`,语义等价、写法本地化:
 * 凭证从 `ctx.upstreamAuth` 取(平台经 authRef 注入,插件不自持),出站走 `guardedFetch`,
 * 错误抛 `TBError` 七码。
 *
 * 凭证走 **header**(`authorization: Bearer <token>`),不进 URL。
 *
 * 四处上游细节决定了这里的形状:
 * - 生命周期三兄弟(start / stop / restart)的成功响应**没有可用的 JSON 体**(Fly 回 200
 *   空体或一段非 JSON 文本),上游用 `expectJson: false` 跳过体解析、统一回 `{ok:true}`。
 *   这是它们与 `wait_for_machine` 的分界:后者有真正的 JSON 结果。
 * - `restart_machine` 的 signal/timeout 走 **query**,而 `stop_machine` 的同名两参走 **body**
 *   —— 这是 Fly API 本身的不对称,不是上游的疏漏,照抄。
 * - Fly 的响应体不保证带 `application/json`,上游按"content-type 说是 JSON **或**首字符像
 *   JSON"两条判据解析,解析失败退回原始文本。错误消息也据此在 `error`/`message`/`details`
 *   三个键里找。
 * - 一批 action 的 `app_name` / `machine_id` / `org_slug` 在上游 schema 里没标 required
 *   (schema.ts 忠实反映),runtime 里却有 `requiredActionString` 断言;必填断言保留在这层。
 *
 * 与上游的有意偏离:
 * - 上游 `mapFlyError` 把 403 压成 401、把一切 5xx 压成 502。这里把原始状态交给
 *   `upstreamError`(403 仍是 permission_denied、404 仍是 not_found),收敛各 provider
 *   互不相同的错误口径正是 `_runtime/upstreamError.ts` 存在的理由。
 * - 上游的 `phase: 'validate'` 分支只服务 `validateFlyCredential`(把 401/403 说成 400)。
 *   它打的 `tokens/current` 不是 action,故这个 provider **不声明 credentialProbe**
 *   —— 九个 action 无一满足"只读且无必填入参"。
 * - 不发 `user-agent`:上游那个值标识的是 open-connector 进程,在这里已无意义。
 * - 上游按 `AbortError`/`TimeoutError` 把传输失败分成 504/502;本地没有 signal 可传,
 *   那条分支不可达,故只保留 502。
 */

import type { z } from 'zod/v4'
import { TBError } from '@tool-bridge/plugin-sdk'
import type {
  createMachineInput,
  getAppInput,
  getMachineInput,
  listAppsInput,
  listMachinesInput,
  restartMachineInput,
  startMachineInput,
  stopMachineInput,
  waitForMachineInput,
} from './schema'
import { type ProviderContext, requireApiKey } from '../_runtime/plugin'
import { upstreamError } from '../_runtime/upstreamError'
import { guardedFetch } from '../_runtime/guardedFetch'

const SERVICE = 'fly'
/** 末尾斜杠是必需的:`new URL('apps', base)` 靠它把 `/v1` 保住而不是替换掉。 */
const API_BASE = 'https://api.machines.dev/v1/'

type Json = Record<string, unknown>
type QueryValue = boolean | number | string | undefined

/** 生命周期动作的固定应答(上游 `{ ok: true }`)。 */
interface Ack { ok: true }

function record(value: unknown): Json | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Json) : undefined
}

/** 上游 `optionalString` 的等价物:去空白后仍非空才算有值。 */
function text(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  return trimmed === '' ? undefined : trimmed
}

/** 上游 `requiredActionString`:schema 没标 required 的字段,必填断言落在这里。 */
function requireText(value: unknown, field: string): string {
  const result = text(value)
  if (result === undefined) throw new TBError('invalid_argument', `${field} is required`)
  return result
}

/** 上游 `jsonObject`:丢掉值为 undefined 的键(`null` 是有意义的值,要留住)。 */
function compact(input: Json): Json {
  return Object.fromEntries(Object.entries(input).filter(([, value]) => value !== undefined))
}

/** 全字段都缺时不发请求体 —— Fly 对空对象体与无体的处理不同。 */
function optionalBody(input: Json): Json | undefined {
  const body = compact(input)
  return Object.keys(body).length === 0 ? undefined : body
}

function buildUrl(path: string, query: Record<string, QueryValue>): string {
  const url = new URL(path, API_BASE)
  for (const [key, value] of Object.entries(query)) {
    // 空串与 undefined 同等对待:Fly 把 `?region=` 当成真的按空 region 过滤。
    if (value === undefined || value === '') continue
    url.searchParams.set(key, String(value))
  }
  return url.toString()
}

function headers(apiKey: string, hasBody: boolean): Record<string, string> {
  return {
    accept: 'application/json',
    authorization: `Bearer ${apiKey}`,
    ...(hasBody ? { 'content-type': 'application/json' } : {}),
  }
}

/**
 * Fly 不保证给对 content-type,故"声明是 JSON"与"看起来像 JSON"任一成立就试解析;
 * 解析不出来就把原文当结果 —— 错误分支要靠它拿到人能读的消息。
 */
function readPayload(response: Response, body: string): unknown {
  if (body === '') return undefined
  const contentType = (response.headers.get('content-type') ?? '').toLowerCase()
  const trimmed = body.trim()
  if (contentType.includes('application/json') || trimmed.startsWith('{') || trimmed.startsWith('[')) {
    try {
      return JSON.parse(body)
    } catch {
      return body
    }
  }
  return body
}

function errorMessage(payload: unknown, status: number): string {
  if (typeof payload === 'string') {
    const message = text(payload)
    if (message !== undefined) return message
  }
  const fields = record(payload)
  if (fields !== undefined) {
    for (const key of ['error', 'message', 'details']) {
      const message = text(fields[key])
      if (message !== undefined) return message
    }
  }
  return `Fly.io request failed with status ${status}`
}

interface RequestInput {
  body?: Json
  /** false 表示成功响应没有可消费的 JSON 体(生命周期动作),不要求非空。 */
  expectJson?: boolean
  method: 'GET' | 'POST'
  path: string
  query?: Record<string, QueryValue>
}

async function request(ctx: ProviderContext, input: RequestInput): Promise<unknown> {
  // 取凭证放在 try 外:它抛的是配置错误,不该被下面的传输失败兜底吞成 502。
  const apiKey = requireApiKey(ctx, SERVICE)

  let response: Response
  let payload: unknown
  try {
    response = await guardedFetch(buildUrl(input.path, input.query ?? {}), {
      method: input.method,
      headers: headers(apiKey, input.body !== undefined),
      body: input.body === undefined ? undefined : JSON.stringify(input.body),
    })
    payload = readPayload(response, await response.text())
  } catch (error) {
    // 传输层失败必须就地归一:漏出去的裸 Error 会被 plugin-sdk 抹成 "internal plugin error"
    // 500。EgressBlockedError 本身是 TBError(invalid_argument),原样冒上去。
    if (error instanceof TBError) throw error
    throw upstreamError(502, error instanceof Error ? error.message : 'Fly.io request failed')
  }

  if (!response.ok) throw upstreamError(response.status, errorMessage(payload, response.status))
  if (input.expectJson === false) return payload
  if (payload === undefined) {
    // 契约说好有结果,却回了空体 —— 是上游出问题,不是调用方的错。
    throw upstreamError(502, 'Fly.io returned an empty response')
  }
  return payload
}

function machinePath(input: { app_name?: string, machine_id?: string }): string {
  const app = encodeURIComponent(requireText(input.app_name, 'app_name'))
  const machine = encodeURIComponent(requireText(input.machine_id, 'machine_id'))
  return `apps/${app}/machines/${machine}`
}

export async function listApps(
  input: z.infer<typeof listAppsInput>,
  ctx: ProviderContext,
): Promise<unknown> {
  return request(ctx, {
    method: 'GET',
    path: 'apps',
    query: { org_slug: requireText(input.org_slug, 'org_slug'), app_role: text(input.app_role) },
  })
}

export async function getApp(
  input: z.infer<typeof getAppInput>,
  ctx: ProviderContext,
): Promise<unknown> {
  return request(ctx, {
    method: 'GET',
    path: `apps/${encodeURIComponent(requireText(input.app_name, 'app_name'))}`,
  })
}

export async function listMachines(
  input: z.infer<typeof listMachinesInput>,
  ctx: ProviderContext,
): Promise<unknown> {
  return request(ctx, {
    method: 'GET',
    path: `apps/${encodeURIComponent(requireText(input.app_name, 'app_name'))}/machines`,
    query: {
      // 显式 false 不发:Fly 只认这两个开关的"出现即为真",带上 `=false` 反而会被当成开启。
      include_deleted: input.include_deleted === true ? true : undefined,
      region: text(input.region),
      state: text(input.state),
      summary: input.summary === true ? true : undefined,
    },
  })
}

export async function createMachine(
  input: z.infer<typeof createMachineInput>,
  ctx: ProviderContext,
): Promise<unknown> {
  const app = encodeURIComponent(requireText(input.app_name, 'app_name'))
  return request(ctx, {
    method: 'POST',
    path: `apps/${app}/machines`,
    // app_name 只进路径,不进请求体 —— 故这里是逐字段列举而不是整体透传。
    body: compact({
      config: input.config,
      lease_ttl: input.lease_ttl,
      lsvd: input.lsvd,
      min_secrets_version: input.min_secrets_version,
      name: text(input.name),
      region: text(input.region),
      skip_launch: input.skip_launch,
      skip_secrets: input.skip_secrets,
      skip_service_registration: input.skip_service_registration,
    }),
  })
}

export async function getMachine(
  input: z.infer<typeof getMachineInput>,
  ctx: ProviderContext,
): Promise<unknown> {
  return request(ctx, { method: 'GET', path: machinePath(input) })
}

export async function startMachine(
  input: z.infer<typeof startMachineInput>,
  ctx: ProviderContext,
): Promise<Ack> {
  await request(ctx, { method: 'POST', expectJson: false, path: `${machinePath(input)}/start` })
  return { ok: true }
}

export async function stopMachine(
  input: z.infer<typeof stopMachineInput>,
  ctx: ProviderContext,
): Promise<Ack> {
  await request(ctx, {
    method: 'POST',
    expectJson: false,
    path: `${machinePath(input)}/stop`,
    // stop 的 signal/timeout 在 body 里(restart 的同名两参在 query 里,别对调)。
    body: optionalBody({ signal: text(input.signal), timeout: text(input.timeout) }),
  })
  return { ok: true }
}

export async function restartMachine(
  input: z.infer<typeof restartMachineInput>,
  ctx: ProviderContext,
): Promise<Ack> {
  await request(ctx, {
    method: 'POST',
    expectJson: false,
    path: `${machinePath(input)}/restart`,
    // restart 的 signal/timeout 在 query 里(stop 的同名两参在 body 里,别对调)。
    query: { signal: text(input.signal), timeout: text(input.timeout) },
  })
  return { ok: true }
}

export async function waitForMachine(
  input: z.infer<typeof waitForMachineInput>,
  ctx: ProviderContext,
): Promise<unknown> {
  return request(ctx, {
    method: 'GET',
    path: `${machinePath(input)}/wait`,
    query: {
      from_event_id: text(input.from_event_id),
      state: text(input.state),
      timeout: typeof input.timeout === 'number' ? input.timeout : undefined,
      version: text(input.version),
    },
  })
}
