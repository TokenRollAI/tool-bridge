/**
 * Plugin 传输客户端:探活、契约抓取、envelope 调用。
 *
 * - envelope 与节点调用同形:POST {endpoint} body `{"tool":"<Method>","arguments":{...}}`,
 *   `X-TB-Context` 承载 CallContext(base64url,唯一载体)、`X-TB-Request-Id` 每次逻辑调用
 *   唯一;编解码复用 core plugin/envelope(体积守卫 ≤ 1 MiB)。
 * - Authorization 按 manifest.auth 解析:platform-token → SecretStore 保留名
 *   `plugin-token:<id>`;bearer → secretRef。
 * - 重试:仅对 retryable TBError 与网络失败重试 1 次,Request-Id 不变。
 * - 超时 30s;响应 4xx/5xx 按 TBError body 归一;`$ref` 不解引用(原样透传调用方)。
 */

import {
  assertPluginPayloadSize,
  base64urlEncode,
  type CallContext,
  encodeCallContext,
  encodePluginCall,
  HEADER_TB_CONTEXT,
  HEADER_TB_REQUEST_ID,
  HEADER_TB_UPSTREAM_AUTH,
  isTBError,
  type PluginManifest,
  type PluginProbeResult,
  pluginTokenSecretName,
  type SecretStoreImpl,
  TB_ERROR_CODES,
  TBError,
  type TBErrorCode,
} from '@tool-bridge/core'

/** 单次探活/抓取/调用超时(默认 30s)。 */
const PLUGIN_TIMEOUT_MS = 30_000

/** retryable:true 仅允许在这三码上;plugin 响应的 retryable 据此消毒。 */
const RETRYABLE_CODES: ReadonlySet<TBErrorCode> = new Set<TBErrorCode>([
  'rate_limited',
  'unavailable',
  'internal',
])

/**
 * 进程内插件装配表:binding 名 → fetch handler(宿主注入,见 TbAppDeps.pluginBindings)。
 * handler 通常闭包持有插件模块与其 env(如 `req => plugin.fetch(req, env)`);
 * 懒加载放进闭包即可(首调时 import()),未挂载/未调用的插件零运行成本。
 */
export type PluginBindingHandler = (request: Request) => Response | Promise<Response>
export type PluginBindings = ReadonlyMap<string, PluginBindingHandler>

const BINDING_PREFIX = 'binding:'
/** binding 请求的合成 origin(进程内直调,不产生网络流量,仅用于构造合法 Request)。 */
const BINDING_ORIGIN = 'https://tb-plugin.internal'

function bindingNameOf(manifest: PluginManifest): string | undefined {
  return manifest.endpoint.startsWith(BINDING_PREFIX)
    ? manifest.endpoint.slice(BINDING_PREFIX.length)
    : undefined
}

/**
 * http(s) endpoint 解析(尾斜杠归一)。`binding:<name>` 不走 URL——传输在
 * {@link pluginFetch} 内直调宿主装配的 handler;直接对 binding manifest 取 URL 是编程错误。
 */
export function resolvePluginEndpoint(manifest: PluginManifest): string {
  if (manifest.endpoint.startsWith(BINDING_PREFIX)) {
    throw new TBError('internal', `plugin '${manifest.id}' 是 binding endpoint,无 URL 可解析`)
  }
  return manifest.endpoint.replace(/\/+$/, '')
}

/**
 * 传输分派:`binding:<name>` → 进程内 handler 直调(envelope 契约不变,无网络跳、
 * 无子请求);https:// → 全局 fetch。binding 未装配 → unavailable(配置错误,不重试);
 * handler 抛错与网络失败同语义(由 attempt 归一为 retryable unavailable)。
 */
async function pluginFetch(
  manifest: PluginManifest,
  bindings: PluginBindings | undefined,
  path: string,
  init: RequestInit,
): Promise<Response> {
  const name = bindingNameOf(manifest)
  if (name === undefined) {
    return await fetch(resolvePluginEndpoint(manifest) + path, {
      ...init,
      signal: AbortSignal.timeout(PLUGIN_TIMEOUT_MS),
    })
  }
  const handler = bindings?.get(name)
  if (handler === undefined) {
    throw new TBError('unavailable', `plugin '${manifest.id}' binding '${name}' 未在本宿主装配`, {
      retryable: false,
    })
  }
  return await handler(new Request(BINDING_ORIGIN + path, init))
}

/** GET {endpoint}{healthPath} → { healthy: true };网络失败/binding 未装配按 unhealthy 报告。 */
export async function probePlugin(
  manifest: PluginManifest,
  bindings?: PluginBindings,
): Promise<PluginProbeResult> {
  let resp: Response
  try {
    resp = await pluginFetch(manifest, bindings, manifest.healthPath, {
      method: 'GET',
      headers: { accept: 'application/json' },
    })
  } catch (err) {
    return { healthy: false, detail: err instanceof Error ? err.message : String(err) }
  }
  if (!resp.ok) return { healthy: false, detail: `HTTP ${resp.status}` }
  const body = (await resp.json().catch(() => null)) as { healthy?: unknown } | null
  if (body?.healthy !== true) return { healthy: false, detail: 'body 非 {healthy:true}' }
  return { healthy: true }
}

async function fetchLifecycle(
  manifest: PluginManifest,
  bindings: PluginBindings | undefined,
  seg: string,
): Promise<Response> {
  let resp: Response
  try {
    resp = await pluginFetch(manifest, bindings, `/${seg}`, {
      method: 'GET',
      headers: { accept: 'application/json' },
    })
  } catch (err) {
    if (isTBError(err)) throw err
    throw new TBError(
      'unavailable',
      `plugin ${seg} 抓取失败:${err instanceof Error ? err.message : String(err)}`,
      { retryable: true },
    )
  }
  if (!resp.ok) {
    throw new TBError('unavailable', `plugin ${seg} 返回 HTTP ${resp.status}`, {
      retryable: resp.status >= 500,
    })
  }
  return resp
}

/**
 * 抓取 `/~describe`(JSON)。供 core plugin write 流程做契约校验。
 */
export async function fetchPluginContract(
  manifest: PluginManifest,
  bindings?: PluginBindings,
): Promise<{ describe: unknown }> {
  const describeResp = await fetchLifecycle(manifest, bindings, '~describe')
  const describe = (await describeResp.json().catch(() => null)) as unknown
  if (describe === null) {
    throw new TBError('invalid_argument', `plugin '${manifest.id}' 的 ~describe 非 JSON`)
  }
  // v2 起不再抓 ~help:export 在 describe 里自报 methods,少一次上游往返。
  return { describe }
}

export interface PluginCallOptions {
  /** 进程内插件装配表;manifest.endpoint 为 binding: 时按名直调。 */
  bindings?: PluginBindings
  /** 调用上下文,经 X-TB-Context 透传。 */
  ctx: CallContext
  manifest: PluginManifest
  secrets: SecretStoreImpl
  /**
   * 挂载 config.authRef:上游凭证引用。给出时每次调用 resolve 并经
   * X-TB-Upstream-Auth(base64url)注入——plugin 无须自持上游凭证。
   */
  upstreamAuthRef?: string
}

/** Authorization 按 manifest.auth 从 SecretStore 解析;无法解析 → unavailable。 */
async function pluginAuthorization(
  manifest: PluginManifest,
  secrets: SecretStoreImpl,
): Promise<string> {
  const name
    = manifest.auth.kind === 'platform-token'
      ? pluginTokenSecretName(manifest.id)
      : manifest.auth.secretRef
  const token = await secrets.resolve(name)
  if (token === undefined) {
    throw new TBError('unavailable', `plugin '${manifest.id}' 凭证 '${name}' 无法解析`, {
      retryable: false,
    })
  }
  return `Bearer ${token}`
}

/** 4xx/5xx → TBError:body 是合法 TBError 形状则原样归一,否则按 HTTP 状态归一。 */
function tbErrorFromPluginResponse(status: number, text: string): TBError {
  interface WireError {
    code?: unknown
    message?: unknown
    retryable?: unknown
  }
  let body: WireError | null = null
  try {
    body = JSON.parse(text) as WireError
  } catch {
    body = null
  }
  const code = body?.code
  if (typeof code === 'string' && (TB_ERROR_CODES as readonly string[]).includes(code)) {
    const tbCode = code as TBErrorCode
    return new TBError(
      tbCode,
      typeof body?.message === 'string' ? body.message : `plugin error '${tbCode}'`,
      { retryable: body?.retryable === true && RETRYABLE_CODES.has(tbCode) },
    )
  }
  return new TBError('unavailable', `plugin returned HTTP ${status}`, {
    retryable: status >= 500,
  })
}

async function attempt(doFetch: () => Promise<Response>): Promise<unknown> {
  let resp: Response
  try {
    resp = await doFetch()
  } catch (err) {
    // binding 未装配等 TBError 原样透传(非重试语义);其余按网络失败归一。
    if (isTBError(err)) throw err
    throw new TBError(
      'unavailable',
      `plugin 调用网络失败:${err instanceof Error ? err.message : String(err)}`,
      { retryable: true },
    )
  }
  const text = await resp.text()
  if (resp.status < 200 || resp.status >= 300) throw tbErrorFromPluginResponse(resp.status, text)
  try {
    assertPluginPayloadSize(text)
  } catch {
    // 响应超 1 MiB 是 plugin 违约(应改走 $ref),归为 unavailable 而非调用方参数错。
    throw new TBError('unavailable', 'plugin 响应超过 1 MiB(更大内容应经 $ref)', {
      retryable: false,
    })
  }
  if (text === '') return null
  try {
    return JSON.parse(text) as unknown
  } catch {
    throw new TBError('unavailable', 'plugin 响应非 JSON', { retryable: false })
  }
}

/**
 * envelope 调用:`tool` 是**方法名**(如 "List"/"Call"),arguments 按名传递。
 * 重试 1 次(retryable TBError / 网络失败),X-TB-Request-Id 不变;响应 `$ref` 原样透传。
 * upstreamAuthRef 给出时 resolve 并经 X-TB-Upstream-Auth(base64url)注入;
 * 引用无法解析 → unavailable(与 pluginToken 同语义:配置错误即快速失败)。
 */
export async function callPlugin(
  opts: PluginCallOptions,
  method: string,
  args: Record<string, unknown>,
): Promise<unknown> {
  const body = encodePluginCall({ tool: method, arguments: args })
  const headers: Record<string, string> = {
    'content-type': 'application/json',
    'accept': 'application/json',
    'authorization': await pluginAuthorization(opts.manifest, opts.secrets),
    [HEADER_TB_CONTEXT]: encodeCallContext(opts.ctx),
    [HEADER_TB_REQUEST_ID]: crypto.randomUUID(),
  }
  if (opts.upstreamAuthRef !== undefined) {
    const cred = await opts.secrets.resolve(opts.upstreamAuthRef)
    if (cred === undefined) {
      throw new TBError(
        'unavailable',
        `plugin '${opts.manifest.id}' 上游凭证 '${opts.upstreamAuthRef}' 无法解析`,
        { retryable: false },
      )
    }
    headers[HEADER_TB_UPSTREAM_AUTH] = base64urlEncode(new TextEncoder().encode(cred))
  }
  const doFetch = (): Promise<Response> =>
    pluginFetch(opts.manifest, opts.bindings, '', { method: 'POST', headers, body })
  try {
    return await attempt(doFetch)
  } catch (err) {
    if (isTBError(err) && err.retryable) return await attempt(doFetch)
    throw err
  }
}
